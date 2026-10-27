import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { forbidden, notFound as notFoundError, ruleViolation } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { getStorage, isLocalStorage } from "@/lib/storage";
import { uuid } from "@/lib/validation";
import { getCtxByEntity } from "@/server/context";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUT /api/attachments/:id/blob — upload target for the *local development* storage driver only
 * (the S3 driver uploads straight to the bucket with a presigned URL). Only the uploader may write,
 * only while the attachment is pending, and never more than the declared size.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const storage = getStorage();
    if (!isLocalStorage(storage)) throw notFoundError("Resource");
    const parsed = uuid.safeParse((await params).id);
    if (!parsed.success) throw notFoundError("Attachment");
    const ctx = await getCtxByEntity("attachments", parsed.data);
    assertCan(ctx.role, "attachment:write");
    const [a] = await getDb()
      .select()
      .from(schema.attachments)
      .where(and(eq(schema.attachments.id, parsed.data), eq(schema.attachments.workspaceId, ctx.workspaceId), isNull(schema.attachments.uploadedAt)));
    if (!a) throw notFoundError("Attachment");
    if (a.uploadedById !== ctx.userId) throw forbidden();
    const declared = Number(request.headers.get("content-length") ?? a.sizeBytes);
    if (declared !== a.sizeBytes) throw ruleViolation("The file size does not match the upload request.");
    await storage.write(a.storageKey, request.body, a.sizeBytes);
    return new Response(null, { status: 200 });
  } catch (e) {
    return errorResponse(e);
  }
}
