"use server";

import { z } from "zod";
import { uuid } from "@/lib/validation";
import { getCtxByEntity, getCtxByProjectId } from "@/server/context";
import { parse, runAction } from "@/server/action";
import * as attachments from "@/server/services/attachments";

const uploadSchema = z.object({
  projectId: uuid,
  taskId: uuid.nullable().optional(),
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(200),
  sizeBytes: z.number().int().positive(),
});

export async function requestUploadAction(input: unknown) {
  return runAction(async () => {
    const v = parse(uploadSchema, input);
    return attachments.requestUpload(await getCtxByProjectId(v.projectId), v);
  });
}

export async function confirmUploadAction(attachmentId: string) {
  return runAction(async () => {
    const id = parse(uuid, attachmentId);
    await attachments.confirmUpload(await getCtxByEntity("attachments", id), id);
  });
}

export async function listAttachmentsAction(projectId: string, taskId?: string) {
  return runAction(async () => {
    const v = parse(z.object({ projectId: uuid, taskId: uuid.optional() }), { projectId, taskId });
    const rows = await attachments.listAttachments(await getCtxByProjectId(v.projectId), v);
    return rows.map((r) => ({
      id: r.attachment.id,
      fileName: r.attachment.fileName,
      contentType: r.attachment.contentType,
      sizeBytes: r.attachment.sizeBytes,
      uploaderId: r.attachment.uploadedById,
      uploaderName: r.uploaderName,
      taskId: r.attachment.taskId,
      taskTitle: r.taskTitle,
      createdAt: r.attachment.createdAt.toISOString(),
    }));
  });
}

export async function deleteAttachmentAction(attachmentId: string) {
  return runAction(async () => {
    const id = parse(uuid, attachmentId);
    await attachments.deleteAttachment(await getCtxByEntity("attachments", id), id);
  });
}
