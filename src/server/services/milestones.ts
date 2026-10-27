import { and, asc, eq, sql } from "drizzle-orm";
import { type DbOrTx, getDb, schema } from "@/db";
import { todayISO } from "@/lib/dates";
import { notFound, ruleViolation } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { milestoneProgress, projectProgress } from "@/lib/progress";
import { assertMilestoneStatusChange, syncCalculatedMilestone } from "@/lib/transitions";
import type { MilestoneInput } from "@/lib/validation";
import type { Ctx } from "../types";
import { logActivity } from "./activity";
import { toProgressMilestone, toProgressTask } from "./metrics";
import { notify } from "./notifications";
import { requireProject } from "./projects";
import { assertWorkspaceMembers } from "./workspaces";

const { milestones, tasks, user, projects, workspaces, projectMembers } = schema;

export type MilestoneRow = typeof milestones.$inferSelect;

async function requireMilestone(db: DbOrTx, ctx: Pick<Ctx, "workspaceId">, id: string): Promise<MilestoneRow> {
  const [m] = await db.select().from(milestones).where(and(eq(milestones.id, id), eq(milestones.workspaceId, ctx.workspaceId)));
  if (!m) throw notFound("Milestone");
  return m;
}

export async function listMilestones(ctx: Ctx, projectId: string) {
  const db = getDb();
  const project = await requireProject(db, ctx, projectId);
  const rows = await db
    .select({ milestone: milestones, ownerName: user.name })
    .from(milestones)
    .leftJoin(user, eq(user.id, milestones.ownerId))
    .where(and(eq(milestones.workspaceId, ctx.workspaceId), eq(milestones.projectId, projectId)))
    .orderBy(asc(milestones.position), asc(milestones.dueDate));
  const ts = await db.select().from(tasks).where(and(eq(tasks.workspaceId, ctx.workspaceId), eq(tasks.projectId, projectId)));
  const progress = projectProgress(rows.map((r) => toProgressMilestone(r.milestone)), ts.map(toProgressTask), project.progressWeighting);
  return rows.map((r) => ({ ...r, progress: progress.milestones[r.milestone.id] }));
}

export async function createMilestone(ctx: Ctx, projectId: string, input: MilestoneInput) {
  assertCan(ctx.role, "milestone:write");
  return getDb().transaction(async (tx) => {
    await requireProject(tx, ctx, projectId);
    await assertWorkspaceMembers(tx, ctx.workspaceId, [input.ownerId]);
    // A new milestone has no tasks yet, so a calculated one may be completed outright (e.g. a one-off event).
    assertMilestoneStatusChange({ to: input.status, progressMode: input.progressMode, percent: input.manualProgress ?? 0, taskCount: 0 });
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${milestones.position}), -1) + 1` })
      .from(milestones)
      .where(eq(milestones.projectId, projectId));
    const completed = input.status === "completed";
    const [m] = await tx
      .insert(milestones)
      .values({
        workspaceId: ctx.workspaceId,
        projectId,
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
        actualDate: completed ? (input.actualDate ?? todayISO()) : input.actualDate,
        ownerId: input.ownerId,
        status: input.status,
        priority: input.priority,
        progressMode: input.progressMode,
        manualProgress: input.progressMode === "manual" ? input.manualProgress : null,
        position: next,
      })
      .returning();
    await logActivity(tx, ctx, { projectId, entityType: "milestone", entityId: m.id, action: "created", metadata: { title: m.title } });
    return m;
  });
}

export async function updateMilestone(ctx: Ctx, milestoneId: string, input: MilestoneInput) {
  assertCan(ctx.role, "milestone:write");
  return getDb().transaction(async (tx) => {
    const prev = await requireMilestone(tx, ctx, milestoneId);
    const project = await requireProject(tx, ctx, prev.projectId);
    await assertWorkspaceMembers(tx, ctx.workspaceId, [input.ownerId]);

    const ts = (await tx.select().from(tasks).where(eq(tasks.milestoneId, milestoneId))).map(toProgressTask);
    const next = { ...prev, progressMode: input.progressMode, manualProgress: input.progressMode === "manual" ? input.manualProgress : null };
    const mp = milestoneProgress(next, ts, project.progressWeighting);
    if (input.status !== prev.status || input.progressMode !== prev.progressMode) {
      assertMilestoneStatusChange({ to: input.status, progressMode: input.progressMode, percent: mp.percent, taskCount: mp.counts.total });
    }
    const completed = input.status === "completed";
    const [m] = await tx
      .update(milestones)
      .set({
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
        actualDate: completed ? (input.actualDate ?? prev.actualDate ?? todayISO()) : input.actualDate,
        ownerId: input.ownerId,
        status: input.status,
        priority: input.priority,
        progressMode: input.progressMode,
        manualProgress: next.manualProgress,
      })
      .where(eq(milestones.id, milestoneId))
      .returning();

    await logActivity(tx, ctx, { projectId: m.projectId, entityType: "milestone", entityId: m.id, action: "updated", metadata: { title: m.title } });
    if (prev.dueDate !== m.dueDate) {
      await logActivity(tx, ctx, { projectId: m.projectId, entityType: "milestone", entityId: m.id, action: "dates_changed", metadata: { title: m.title, from: prev.dueDate, to: m.dueDate } });
    }
    if (prev.status !== "completed" && m.status === "completed") await announceCompleted(tx, ctx, m);
    if (prev.status === "completed" && m.status !== "completed") {
      await logActivity(tx, ctx, { projectId: m.projectId, entityType: "milestone", entityId: m.id, action: "reopened", metadata: { title: m.title } });
    }
    // Calculated milestones follow their tasks, so re-derive in case the new mode/status disagrees.
    await reconcileMilestone(tx, ctx, m.id);
    return m;
  });
}

/** Deleting a milestone keeps its tasks; they become unassigned (project progress changes accordingly). */
export async function deleteMilestone(ctx: Ctx, milestoneId: string) {
  assertCan(ctx.role, "milestone:write");
  await getDb().transaction(async (tx) => {
    const m = await requireMilestone(tx, ctx, milestoneId);
    await tx.delete(milestones).where(eq(milestones.id, milestoneId));
    await logActivity(tx, ctx, { projectId: m.projectId, entityType: "milestone", entityId: m.id, action: "deleted", metadata: { title: m.title } });
  });
}

export async function reorderMilestones(ctx: Ctx, projectId: string, orderedIds: string[]) {
  assertCan(ctx.role, "milestone:write");
  await getDb().transaction(async (tx) => {
    await requireProject(tx, ctx, projectId);
    const current = await tx.select({ id: milestones.id }).from(milestones).where(eq(milestones.projectId, projectId));
    const same = current.length === orderedIds.length && current.every((c) => orderedIds.includes(c.id));
    if (!same) throw ruleViolation("The milestone list changed. Refresh and try again.");
    for (const [position, id] of orderedIds.entries()) {
      await tx.update(milestones).set({ position }).where(and(eq(milestones.id, id), eq(milestones.workspaceId, ctx.workspaceId)));
    }
  });
}

async function announceCompleted(tx: DbOrTx, ctx: Pick<Ctx, "workspaceId" | "userId">, m: MilestoneRow) {
  await logActivity(tx, ctx, { projectId: m.projectId, entityType: "milestone", entityId: m.id, action: "completed", metadata: { title: m.title } });
  const [p] = await tx.select({ id: projects.id, ownerId: projects.ownerId, title: projects.title }).from(projects).where(eq(projects.id, m.projectId));
  const [ws] = await tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  const team = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, m.projectId));
  await notify(tx, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    recipientIds: [p.ownerId, m.ownerId, ...team.map((t) => t.userId)],
    type: "milestone_completed",
    title: `Milestone completed: ${m.title}`,
    body: `in ${p.title}`,
    link: `/w/${ws.slug}/projects/${m.projectId}#milestones`,
  });
}

/**
 * Re-derives a calculated milestone's status from its tasks (see lib/transitions). Called after any
 * change to tasks that could affect it, inside the same transaction.
 */
export async function reconcileMilestone(tx: DbOrTx, ctx: Pick<Ctx, "workspaceId" | "userId">, milestoneId: string | null | undefined) {
  if (!milestoneId) return;
  const [m] = await tx.select().from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.workspaceId, ctx.workspaceId)));
  if (!m) return;
  const [project] = await tx.select({ w: projects.progressWeighting }).from(projects).where(eq(projects.id, m.projectId));
  const rows = await tx.select().from(tasks).where(eq(tasks.milestoneId, milestoneId));
  const mp = milestoneProgress(m, rows.map(toProgressTask), project.w);
  const change = syncCalculatedMilestone({
    status: m.status,
    progressMode: m.progressMode,
    percent: mp.percent,
    taskCount: mp.counts.total,
    anyStarted: rows.some((t) => t.status === "in_progress" || t.status === "done" || (t.progress ?? 0) > 0),
    actualDate: m.actualDate,
    today: todayISO(),
  });
  if (!change) return;
  const [updated] = await tx.update(milestones).set(change).where(eq(milestones.id, milestoneId)).returning();
  if (m.status !== "completed" && updated.status === "completed") await announceCompleted(tx, ctx, updated);
  else if (m.status === "completed" && updated.status !== "completed") {
    await logActivity(tx, ctx, { projectId: m.projectId, entityType: "milestone", entityId: m.id, action: "reopened", metadata: { title: m.title } });
  }
}
