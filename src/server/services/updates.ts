import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { forbidden, notFound, ruleViolation } from "@/lib/errors";
import { assertCan, canModifyUpdate } from "@/lib/permissions";
import type { ProjectUpdateInput } from "@/lib/validation";
import type { Ctx } from "../types";
import { logActivity } from "./activity";
import { getProjectMetrics, requireProject } from "./projects";

const { projectUpdates, user } = schema;
const author = user;

export type UpdateRow = typeof projectUpdates.$inferSelect;

/**
 * Published updates are append-only (see schema docs): publish inserts, edit inserts a new revision
 * and marks the previous one superseded, retract soft-deletes with a reason. Nothing is ever
 * overwritten or removed, and every action is written to the activity log.
 */
export async function publishUpdate(ctx: Ctx, projectId: string, input: ProjectUpdateInput) {
  assertCan(ctx.role, "update:publish");
  return getDb().transaction(async (tx) => {
    const project = await requireProject(tx, ctx, projectId);
    const { metrics } = await getProjectMetrics(tx, ctx, project);
    const [u] = await tx
      .insert(projectUpdates)
      .values({ ...input, workspaceId: ctx.workspaceId, projectId, authorId: ctx.userId, progressSnapshot: metrics.progress })
      .returning();
    await logActivity(tx, ctx, { projectId, entityType: "update", entityId: u.id, action: "published", metadata: { title: u.title } });
    return u;
  });
}

async function requireUpdate(tx: Pick<ReturnType<typeof getDb>, "select">, ctx: Ctx, id: string) {
  const [u] = await tx.select().from(projectUpdates).where(and(eq(projectUpdates.id, id), eq(projectUpdates.workspaceId, ctx.workspaceId)));
  if (!u) throw notFound("Update");
  return u;
}

export async function editUpdate(ctx: Ctx, updateId: string, input: ProjectUpdateInput) {
  return getDb().transaction(async (tx) => {
    const prev = await requireUpdate(tx, ctx, updateId);
    if (!canModifyUpdate(ctx.role, prev.authorId, ctx.userId)) throw forbidden();
    if (prev.supersededAt) throw ruleViolation("This update has a newer revision. Edit the latest one.");
    if (prev.retractedAt) throw ruleViolation("A retracted update cannot be edited.");
    await tx.update(projectUpdates).set({ supersededAt: new Date() }).where(eq(projectUpdates.id, prev.id));
    const [u] = await tx
      .insert(projectUpdates)
      .values({
        ...input,
        workspaceId: ctx.workspaceId,
        projectId: prev.projectId,
        authorId: prev.authorId,
        progressSnapshot: prev.progressSnapshot,
        supersedesId: prev.id,
      })
      .returning();
    await logActivity(tx, ctx, { projectId: prev.projectId, entityType: "update", entityId: u.id, action: "edited", metadata: { title: u.title, supersedes: prev.id } });
    return u;
  });
}

export async function retractUpdate(ctx: Ctx, updateId: string, reason: string) {
  await getDb().transaction(async (tx) => {
    const u = await requireUpdate(tx, ctx, updateId);
    if (!canModifyUpdate(ctx.role, u.authorId, ctx.userId)) throw forbidden();
    if (u.retractedAt) throw ruleViolation("This update was already retracted.");
    if (u.supersededAt) throw ruleViolation("This update has a newer revision. Retract the latest one.");
    const cleaned = reason.trim();
    if (!cleaned) throw ruleViolation("Give a reason for retracting this update.");
    await tx
      .update(projectUpdates)
      .set({ retractedAt: new Date(), retractedById: ctx.userId, retractReason: cleaned.slice(0, 500) })
      .where(eq(projectUpdates.id, updateId));
    await logActivity(tx, ctx, { projectId: u.projectId, entityType: "update", entityId: u.id, action: "retracted", metadata: { title: u.title, reason: cleaned.slice(0, 500) } });
  });
}

/** Current revisions (newest first), including retracted ones, which the UI shows as withdrawn. */
export async function listUpdates(ctx: Ctx, projectId: string, limit = 50) {
  const db = getDb();
  await requireProject(db, ctx, projectId);
  const rows = await db
    .select({ update: projectUpdates, authorName: author.name })
    .from(projectUpdates)
    .leftJoin(author, eq(author.id, projectUpdates.authorId))
    .where(and(eq(projectUpdates.projectId, projectId), eq(projectUpdates.workspaceId, ctx.workspaceId), isNull(projectUpdates.supersededAt)))
    .orderBy(desc(projectUpdates.createdAt))
    .limit(limit);
  const revisions = await db
    .select({ id: projectUpdates.id, supersedesId: projectUpdates.supersedesId })
    .from(projectUpdates)
    .where(and(eq(projectUpdates.projectId, projectId), eq(projectUpdates.workspaceId, ctx.workspaceId)));
  const bySuper = new Map(revisions.filter((r) => r.supersedesId).map((r) => [r.id, r.supersedesId!]));
  const depth = (id: string) => {
    let n = 0;
    for (let cur = bySuper.get(id); cur; cur = bySuper.get(cur)) n++;
    return n;
  };
  return rows.map((r) => ({ ...r, revisions: depth(r.update.id) }));
}
