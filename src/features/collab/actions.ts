"use server";

import { z } from "zod";
import { commentSchema, projectUpdateSchema, riskSchema, uuid } from "@/lib/validation";
import { getCtxByEntity, getCtxByProjectId } from "@/server/context";
import { parse, runAction } from "@/server/action";
import * as comments from "@/server/services/comments";
import * as risks from "@/server/services/risks";
import * as updates from "@/server/services/updates";

export async function publishUpdateAction(projectId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    await updates.publishUpdate(await getCtxByProjectId(id), id, parse(projectUpdateSchema, input));
  });
}

export async function editUpdateAction(updateId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, updateId);
    await updates.editUpdate(await getCtxByEntity("projectUpdates", id), id, parse(projectUpdateSchema, input));
  });
}

export async function retractUpdateAction(updateId: string, reason: string) {
  return runAction(async () => {
    const id = parse(uuid, updateId);
    await updates.retractUpdate(await getCtxByEntity("projectUpdates", id), id, parse(z.string().max(500), reason));
  });
}

const targetSchema = z.union([z.object({ taskId: uuid }).strict(), z.object({ milestoneId: uuid }).strict(), z.object({ updateId: uuid }).strict()]);
type Target = z.infer<typeof targetSchema>;

export async function addCommentAction(rawTarget: unknown, input: unknown, parentId?: string | null) {
  return runAction(async () => {
    const target = parse(targetSchema, rawTarget);
    const ctx = await getCtxByEntity(...entityOf(target));
    await comments.addComment(ctx, target, parse(commentSchema, input).body, parentId ? parse(uuid, parentId) : null);
  });
}

function entityOf(t: Target): ["tasks" | "milestones" | "projectUpdates", string] {
  return "taskId" in t ? ["tasks", t.taskId] : "milestoneId" in t ? ["milestones", t.milestoneId] : ["projectUpdates", t.updateId];
}

export async function deleteCommentAction(commentId: string) {
  return runAction(async () => {
    const id = parse(uuid, commentId);
    await comments.deleteComment(await getCtxByEntity("comments", id), id);
  });
}

export async function createRiskAction(projectId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    await risks.createRisk(await getCtxByProjectId(id), id, parse(riskSchema, input));
  });
}

export async function updateRiskAction(riskId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, riskId);
    await risks.updateRisk(await getCtxByEntity("risks", id), id, parse(riskSchema, input));
  });
}

export async function deleteRiskAction(riskId: string) {
  return runAction(async () => {
    const id = parse(uuid, riskId);
    await risks.deleteRisk(await getCtxByEntity("risks", id), id);
  });
}

export async function loadCommentsAction(rawTarget: unknown) {
  return runAction(async () => {
    const target = parse(targetSchema, rawTarget);
    const rows = await comments.listComments(await getCtxByEntity(...entityOf(target)), target);
    return rows.map((c) => ({
      id: c.comment.id,
      parentId: c.comment.parentId,
      authorId: c.comment.authorId,
      authorName: c.authorName,
      body: c.comment.body,
      deleted: !!c.comment.deletedAt,
      createdAt: c.comment.createdAt.toISOString(),
    }));
  });
}
