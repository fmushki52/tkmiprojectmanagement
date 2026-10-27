import { and, asc, eq } from "drizzle-orm";
import { type DbOrTx, getDb, schema } from "@/db";
import { forbidden, notFound, ruleViolation } from "@/lib/errors";
import { extractMentions } from "@/lib/mentions";
import { assertCan, can } from "@/lib/permissions";
import type { Ctx } from "../types";
import { logActivity } from "./activity";
import { notify } from "./notifications";
import { listMembers } from "./workspaces";

const { comments, tasks, milestones, projectUpdates, user, workspaces } = schema;

export type CommentTarget = { taskId: string } | { milestoneId: string } | { updateId: string };

async function resolveTarget(tx: DbOrTx, ctx: Ctx, target: CommentTarget) {
  if ("taskId" in target) {
    const [t] = await tx.select().from(tasks).where(and(eq(tasks.id, target.taskId), eq(tasks.workspaceId, ctx.workspaceId)));
    if (!t) throw notFound("Task");
    return { projectId: t.projectId, label: "task", title: t.title, watchers: [t.assigneeId, t.createdById], where: eq(comments.taskId, t.id) };
  }
  if ("milestoneId" in target) {
    const [m] = await tx.select().from(milestones).where(and(eq(milestones.id, target.milestoneId), eq(milestones.workspaceId, ctx.workspaceId)));
    if (!m) throw notFound("Milestone");
    return { projectId: m.projectId, label: "milestone", title: m.title, watchers: [m.ownerId], where: eq(comments.milestoneId, m.id) };
  }
  const [u] = await tx.select().from(projectUpdates).where(and(eq(projectUpdates.id, target.updateId), eq(projectUpdates.workspaceId, ctx.workspaceId)));
  if (!u) throw notFound("Update");
  return { projectId: u.projectId, label: "update", title: u.title, watchers: [u.authorId], where: eq(comments.updateId, u.id) };
}

export async function listComments(ctx: Ctx, target: CommentTarget) {
  const db = getDb();
  const t = await resolveTarget(db, ctx, target);
  return db
    .select({ comment: comments, authorName: user.name })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorId))
    .where(and(t.where, eq(comments.workspaceId, ctx.workspaceId)))
    .orderBy(asc(comments.createdAt));
}

export async function addComment(ctx: Ctx, target: CommentTarget, body: string, parentId?: string | null) {
  assertCan(ctx.role, "comment:write");
  const text = body.trim();
  if (!text) throw ruleViolation("Write a comment first.");
  return getDb().transaction(async (tx) => {
    const t = await resolveTarget(tx, ctx, target);
    if (parentId) {
      const [parent] = await tx.select({ id: comments.id, parentId: comments.parentId, projectId: comments.projectId }).from(comments).where(and(eq(comments.id, parentId), eq(comments.workspaceId, ctx.workspaceId)));
      if (!parent || parent.projectId !== t.projectId) throw ruleViolation("The comment you are replying to no longer exists.");
      if (parent.parentId) parentId = parent.parentId; // replies stay one level deep
    }
    const [c] = await tx
      .insert(comments)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: t.projectId,
        taskId: "taskId" in target ? target.taskId : null,
        milestoneId: "milestoneId" in target ? target.milestoneId : null,
        updateId: "updateId" in target ? target.updateId : null,
        parentId: parentId ?? null,
        authorId: ctx.userId,
        body: text,
      })
      .returning();

    const members = await listMembers(ctx, tx);
    const mentioned = extractMentions(text, members);
    const [ws] = await tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
    const link =
      `/w/${ws.slug}/projects/${t.projectId}` + ("taskId" in target ? `?task=${target.taskId}` : "milestoneId" in target ? "#milestones" : "#updates");
    const me = members.find((m) => m.userId === ctx.userId)?.name ?? "Someone";
    await notify(tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, recipientIds: mentioned, type: "mention", title: `${me} mentioned you on ${t.label} “${t.title}”`, body: text.slice(0, 200), link });
    await notify(tx, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      recipientIds: t.watchers.filter((w) => !mentioned.includes(w ?? "")),
      type: "comment",
      title: `${me} commented on ${t.label} “${t.title}”`,
      body: text.slice(0, 200),
      link,
    });
    await logActivity(tx, ctx, { projectId: t.projectId, entityType: "comment", entityId: c.id, action: "created", metadata: { title: t.title, on: t.label } });
    return c;
  });
}

/** Soft delete; the author or anyone who can moderate may remove a comment. */
export async function deleteComment(ctx: Ctx, commentId: string) {
  await getDb().transaction(async (tx) => {
    const [c] = await tx.select().from(comments).where(and(eq(comments.id, commentId), eq(comments.workspaceId, ctx.workspaceId)));
    if (!c) throw notFound("Comment");
    if (c.authorId !== ctx.userId && !can(ctx.role, "update:moderate")) throw forbidden();
    await tx.update(comments).set({ deletedAt: new Date(), body: "" }).where(eq(comments.id, commentId));
  });
}
