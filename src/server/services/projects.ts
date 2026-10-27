import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { type DbOrTx, getDb, schema } from "@/db";
import { todayISO } from "@/lib/dates";
import { notFound } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { projectStatusEffects } from "@/lib/transitions";
import type { ProjectInput } from "@/lib/validation";
import type { Ctx } from "../types";
import { logActivity } from "./activity";
import { type ProjectMetrics, computeMetrics } from "./metrics";
import { notify } from "./notifications";
import { attachmentKeysWhere, collectStorageKeys, removeObjects } from "./storage-cleanup";
import { assertWorkspaceMembers } from "./workspaces";

const { projects, projectMembers, milestones, tasks, risks, user, workspaces } = schema;

export type ProjectRow = typeof projects.$inferSelect;

/** Loads a project only if it belongs to the caller's workspace; otherwise NOT_FOUND. */
export async function requireProject(db: DbOrTx, ctx: Pick<Ctx, "workspaceId">, projectId: string): Promise<ProjectRow> {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)));
  if (!p) throw notFound("Project");
  return p;
}

/** Everything needed to compute a project's metrics. */
export async function loadProjectData(db: DbOrTx, workspaceId: string, projectId: string) {
  const [ms, ts, rs] = await Promise.all([
    db.select().from(milestones).where(and(eq(milestones.workspaceId, workspaceId), eq(milestones.projectId, projectId))).orderBy(asc(milestones.position)),
    db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.projectId, projectId))),
    db.select().from(risks).where(and(eq(risks.workspaceId, workspaceId), eq(risks.projectId, projectId))),
  ]);
  return { milestones: ms, tasks: ts, risks: rs };
}

export async function getProjectMetrics(db: DbOrTx, ctx: Pick<Ctx, "workspaceId">, project: ProjectRow, today = todayISO()) {
  const data = await loadProjectData(db, ctx.workspaceId, project.id);
  return { ...data, metrics: computeMetrics(project, data.milestones, data.tasks, data.risks, today) };
}

export interface ProjectListQuery {
  q?: string;
  status?: ProjectRow["status"];
  priority?: ProjectRow["priority"];
  scope?: "active" | "archived" | "all";
  sort?: "updated" | "title" | "start" | "end" | "priority" | "status";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface ProjectListItem {
  project: ProjectRow;
  ownerName: string | null;
  metrics: ProjectMetrics;
  memberCount: number;
}

const PRIORITY_RANK = sql`CASE ${projects.priority} WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;

export async function listProjects(ctx: Ctx, query: ProjectListQuery = {}, today = todayISO()) {
  const db = getDb();
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 12));
  const filters: SQL[] = [eq(projects.workspaceId, ctx.workspaceId)];
  const scope = query.scope ?? "active";
  if (scope === "active") filters.push(isNull(projects.archivedAt));
  if (scope === "archived") filters.push(isNotNull(projects.archivedAt));
  if (query.status) filters.push(eq(projects.status, query.status));
  if (query.priority) filters.push(eq(projects.priority, query.priority));
  if (query.q?.trim()) {
    const like = `%${query.q.trim().replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(projects.title, like), ilike(projects.description, like), sql`array_to_string(${projects.tags}, ' ') ILIKE ${like}`)!);
  }
  const where = and(...filters);

  const dir = query.dir === "asc" ? asc : desc;
  const sortCol = {
    updated: projects.updatedAt,
    title: projects.title,
    start: projects.startDate,
    end: projects.plannedEndDate,
    priority: PRIORITY_RANK,
    status: projects.status,
  }[query.sort ?? "updated"];

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(projects).where(where);
  const rows = await db
    .select({ project: projects, ownerName: user.name })
    .from(projects)
    .leftJoin(user, eq(user.id, projects.ownerId))
    .where(where)
    .orderBy(dir(sortCol), asc(projects.title))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = rows.map((r) => r.project.id);
  const items: ProjectListItem[] = [];
  if (ids.length) {
    const [ms, ts, rs, members] = await Promise.all([
      db.select().from(milestones).where(and(eq(milestones.workspaceId, ctx.workspaceId), inArray(milestones.projectId, ids))),
      db.select().from(tasks).where(and(eq(tasks.workspaceId, ctx.workspaceId), inArray(tasks.projectId, ids))),
      db.select().from(risks).where(and(eq(risks.workspaceId, ctx.workspaceId), inArray(risks.projectId, ids))),
      db
        .select({ projectId: projectMembers.projectId, n: sql<number>`count(*)::int` })
        .from(projectMembers)
        .where(inArray(projectMembers.projectId, ids))
        .groupBy(projectMembers.projectId),
    ]);
    for (const r of rows) {
      const id = r.project.id;
      items.push({
        project: r.project,
        ownerName: r.ownerName,
        metrics: computeMetrics(r.project, ms.filter((m) => m.projectId === id), ts.filter((t) => t.projectId === id), rs.filter((x) => x.projectId === id), today),
        memberCount: members.find((m) => m.projectId === id)?.n ?? 0,
      });
    }
  }
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getProjectDetail(ctx: Ctx, projectId: string) {
  const db = getDb();
  const project = await requireProject(db, ctx, projectId);
  const members = await db
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(user.name));
  const [owner] = project.ownerId
    ? await db.select({ id: user.id, name: user.name, email: user.email }).from(user).where(eq(user.id, project.ownerId))
    : [];
  return { project, members, owner: owner ?? null };
}

export async function createProject(ctx: Ctx, input: ProjectInput) {
  assertCan(ctx.role, "project:create");
  const today = todayISO();
  return getDb().transaction(async (tx) => {
    await assertWorkspaceMembers(tx, ctx.workspaceId, [input.ownerId, ...input.memberIds]);
    const effects = projectStatusEffects({ status: "planning", actualStartDate: input.actualStartDate, actualEndDate: input.actualEndDate }, input.status, today);
    const [p] = await tx
      .insert(projects)
      .values({
        workspaceId: ctx.workspaceId,
        title: input.title,
        description: input.description,
        scope: input.scope,
        startDate: input.startDate,
        plannedEndDate: input.plannedEndDate,
        actualStartDate: effects.actualStartDate,
        actualEndDate: effects.actualEndDate,
        ownerId: input.ownerId ?? ctx.userId,
        status: input.status,
        priority: input.priority,
        health: input.health,
        color: input.color,
        tags: input.tags,
        progressWeighting: input.progressWeighting,
        createdById: ctx.userId,
      })
      .returning();
    const memberIds = Array.from(new Set([p.ownerId, ...input.memberIds].filter((x): x is string => !!x)));
    if (memberIds.length) {
      await tx.insert(projectMembers).values(memberIds.map((userId) => ({ workspaceId: ctx.workspaceId, projectId: p.id, userId })));
    }
    await logActivity(tx, ctx, { projectId: p.id, entityType: "project", entityId: p.id, action: "created", metadata: { title: p.title } });
    return p;
  });
}

export async function updateProject(ctx: Ctx, projectId: string, input: ProjectInput) {
  assertCan(ctx.role, "project:update");
  const today = todayISO();
  return getDb().transaction(async (tx) => {
    const prev = await requireProject(tx, ctx, projectId);
    await assertWorkspaceMembers(tx, ctx.workspaceId, [input.ownerId, ...input.memberIds]);
    const effects = projectStatusEffects(
      { status: prev.status, actualStartDate: input.actualStartDate, actualEndDate: input.actualEndDate },
      input.status,
      today,
    );
    const [p] = await tx
      .update(projects)
      .set({
        title: input.title,
        description: input.description,
        scope: input.scope,
        startDate: input.startDate,
        plannedEndDate: input.plannedEndDate,
        actualStartDate: effects.actualStartDate,
        actualEndDate: effects.actualEndDate,
        ownerId: input.ownerId,
        status: input.status,
        priority: input.priority,
        health: input.health,
        color: input.color,
        tags: input.tags,
        progressWeighting: input.progressWeighting,
      })
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)))
      .returning();

    // Replace team membership (owner is always a member).
    const memberIds = Array.from(new Set([p.ownerId, ...input.memberIds].filter((x): x is string => !!x)));
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    if (memberIds.length) {
      await tx.insert(projectMembers).values(memberIds.map((userId) => ({ workspaceId: ctx.workspaceId, projectId, userId })));
    }

    await logActivity(tx, ctx, { projectId, entityType: "project", entityId: projectId, action: "updated", metadata: { title: p.title } });
    if (prev.status !== p.status) {
      await logActivity(tx, ctx, { projectId, entityType: "project", entityId: projectId, action: "status_changed", metadata: { from: prev.status, to: p.status, title: p.title } });
      await notifyProjectTeam(tx, ctx, p, "project_status_changed", `${p.title} is now ${p.status.replaceAll("_", " ")}`, `Status changed from ${prev.status.replaceAll("_", " ")}.`);
    }
    if (prev.startDate !== p.startDate || prev.plannedEndDate !== p.plannedEndDate) {
      await logActivity(tx, ctx, {
        projectId, entityType: "project", entityId: projectId, action: "dates_changed",
        metadata: { from: `${prev.startDate} – ${prev.plannedEndDate}`, to: `${p.startDate} – ${p.plannedEndDate}`, title: p.title },
      });
    }
    return p;
  });
}

export async function setProjectArchived(ctx: Ctx, projectId: string, archived: boolean) {
  assertCan(ctx.role, "project:archive");
  await getDb().transaction(async (tx) => {
    const p = await requireProject(tx, ctx, projectId);
    await tx.update(projects).set({ archivedAt: archived ? new Date() : null }).where(eq(projects.id, p.id));
    await logActivity(tx, ctx, { projectId, entityType: "project", entityId: projectId, action: archived ? "archived" : "unarchived", metadata: { title: p.title } });
  });
}

/** Permanent. Cascades to milestones, tasks, updates, risks, comments and activity of the project. */
export async function deleteProject(ctx: Ctx, projectId: string) {
  assertCan(ctx.role, "project:delete");
  const keys = await collectStorageKeys(attachmentKeysWhere.project(ctx.workspaceId, projectId));
  await getDb().transaction(async (tx) => {
    await requireProject(tx, ctx, projectId);
    await tx.delete(projects).where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)));
  });
  await removeObjects(keys);
}

export async function listProjectMembers(ctx: Ctx, projectId: string) {
  await requireProject(getDb(), ctx, projectId);
  return getDb()
    .select({ userId: user.id, name: user.name })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.workspaceId, ctx.workspaceId)))
    .orderBy(asc(user.name));
}

export async function notifyProjectTeam(
  tx: DbOrTx,
  ctx: Pick<Ctx, "workspaceId" | "userId">,
  project: Pick<ProjectRow, "id" | "ownerId">,
  type: (typeof schema.notificationType.enumValues)[number],
  title: string,
  body: string,
  extra: { dedupeKey?: string; hash?: string } = {},
) {
  const members = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, project.id));
  const [ws] = await tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  return notify(tx, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    recipientIds: [project.ownerId, ...members.map((m) => m.userId)],
    type,
    title,
    body,
    link: `/w/${ws.slug}/projects/${project.id}${extra.hash ?? ""}`,
    dedupeKey: extra.dedupeKey,
  });
}
