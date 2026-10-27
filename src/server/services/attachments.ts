import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lt, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { forbidden, notFound, ruleViolation } from "@/lib/errors";
import { assertCan, can } from "@/lib/permissions";
import { getStorage, type UploadTarget } from "@/lib/storage";
import { MAX_ATTACHMENT_BYTES, buildStorageKey, validateUpload } from "@/lib/storage/rules";
import type { Ctx } from "../types";
import { logActivity } from "./activity";
import { requireProject } from "./projects";
import { removeObjects } from "./storage-cleanup";

const { attachments, tasks, user } = schema;

const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+$/;
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface UploadRequest {
  projectId: string;
  taskId?: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Upload is two-phase so unverified files never become visible:
 *  1. requestUpload: authorize, validate, insert a *pending* row and hand back a short-lived upload target.
 *  2. The browser sends the bytes straight to object storage.
 *  3. confirmUpload: the server checks the stored object (exists, exact size) before marking it uploaded.
 */
export async function requestUpload(ctx: Ctx, input: UploadRequest): Promise<{ attachmentId: string; target: UploadTarget }> {
  assertCan(ctx.role, "attachment:write");
  const db = getDb();
  await requireProject(db, ctx, input.projectId);
  if (input.taskId) {
    const [t] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId), eq(tasks.workspaceId, ctx.workspaceId)));
    if (!t) throw notFound("Task");
  }
  const fileName = validateUpload(input);
  const contentType = CONTENT_TYPE.test(input.contentType) && input.contentType.length <= 120 ? input.contentType.toLowerCase() : "application/octet-stream";
  const id = randomUUID();
  const storageKey = buildStorageKey({ workspaceId: ctx.workspaceId, projectId: input.projectId, attachmentId: id, fileName });
  await db.insert(attachments).values({
    id,
    workspaceId: ctx.workspaceId,
    projectId: input.projectId,
    taskId: input.taskId ?? null,
    uploadedById: ctx.userId,
    fileName,
    contentType,
    sizeBytes: input.sizeBytes,
    storageKey,
  });
  const target = await getStorage().createUploadTarget({ key: storageKey, contentType, attachmentId: id });
  return { attachmentId: id, target };
}

async function requireAttachment(ctx: Pick<Ctx, "workspaceId">, id: string) {
  const [a] = await getDb()
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.workspaceId, ctx.workspaceId)));
  if (!a) throw notFound("Attachment");
  return a;
}

export async function confirmUpload(ctx: Ctx, attachmentId: string) {
  assertCan(ctx.role, "attachment:write");
  const a = await requireAttachment(ctx, attachmentId);
  if (a.uploadedById !== ctx.userId) throw forbidden();
  if (a.uploadedAt) return a; // idempotent
  const storage = getStorage();
  const stored = await storage.head(a.storageKey);
  if (!stored) throw ruleViolation("The upload did not complete. Please try again.");
  if (stored.sizeBytes !== a.sizeBytes || stored.sizeBytes > MAX_ATTACHMENT_BYTES) {
    await storage.remove(a.storageKey);
    await getDb().delete(attachments).where(eq(attachments.id, a.id));
    throw ruleViolation("The uploaded file did not match its declared size and was discarded.");
  }
  return getDb().transaction(async (tx) => {
    const [row] = await tx.update(attachments).set({ uploadedAt: new Date() }).where(eq(attachments.id, a.id)).returning();
    await logActivity(tx, ctx, { projectId: a.projectId, entityType: "attachment", entityId: a.id, action: "added", metadata: { title: a.fileName } });
    return row;
  });
}

export async function listAttachments(ctx: Ctx, input: { projectId: string; taskId?: string }) {
  const db = getDb();
  await requireProject(db, ctx, input.projectId);
  const filters: SQL[] = [eq(attachments.workspaceId, ctx.workspaceId), eq(attachments.projectId, input.projectId), isNotNull(attachments.uploadedAt)];
  if (input.taskId) filters.push(eq(attachments.taskId, input.taskId));
  return db
    .select({ attachment: attachments, uploaderName: user.name, taskTitle: tasks.title })
    .from(attachments)
    .leftJoin(user, eq(user.id, attachments.uploadedById))
    .leftJoin(tasks, eq(tasks.id, attachments.taskId))
    .where(and(...filters))
    .orderBy(asc(attachments.createdAt));
}

/** Verified, uploaded attachment in the caller's workspace (any member may download). */
export async function getDownloadable(ctx: Ctx, attachmentId: string) {
  const a = await requireAttachment(ctx, attachmentId);
  if (!a.uploadedAt) throw notFound("Attachment");
  return a;
}

export async function deleteAttachment(ctx: Ctx, attachmentId: string) {
  const a = await requireAttachment(ctx, attachmentId);
  const mine = a.uploadedById === ctx.userId && can(ctx.role, "attachment:write");
  if (!mine && !can(ctx.role, "update:moderate")) throw forbidden();
  // Remove the object first (idempotent) so a failure leaves the row in place and the user can retry.
  await getStorage().remove(a.storageKey);
  await getDb().transaction(async (tx) => {
    await tx.delete(attachments).where(eq(attachments.id, a.id));
    await logActivity(tx, ctx, { projectId: a.projectId, entityType: "attachment", entityId: a.id, action: "deleted", metadata: { title: a.fileName } });
  });
}

/** Removes uploads that were requested but never confirmed (abandoned/failed). Run by the daily cron. */
export async function purgePendingAttachments(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_TTL_MS);
  const stale = await getDb()
    .select({ id: attachments.id, key: attachments.storageKey })
    .from(attachments)
    .where(and(isNull(attachments.uploadedAt), lt(attachments.createdAt, cutoff)));
  if (!stale.length) return 0;
  await removeObjects(stale.map((s) => s.key));
  await getDb().delete(attachments).where(inArray(attachments.id, stale.map((s) => s.id)));
  return stale.length;
}

