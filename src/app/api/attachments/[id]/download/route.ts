import { notFound as notFoundError } from "@/lib/errors";
import { getStorage, isLocalStorage } from "@/lib/storage";
import { attachmentDisposition } from "@/lib/storage/rules";
import { getCtxByEntity } from "@/server/context";
import { errorResponse } from "@/server/http";
import { getDownloadable } from "@/server/services/attachments";
import { uuid } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/attachments/:id/download
 * Authorizes the caller against the attachment's workspace, then either redirects to a 60-second
 * presigned URL (S3) or streams the file (local dev). Always served as a download, never inline.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = uuid.safeParse((await params).id);
    if (!parsed.success) throw notFoundError("Attachment");
    const ctx = await getCtxByEntity("attachments", parsed.data);
    const a = await getDownloadable(ctx, parsed.data);
    const storage = getStorage();
    const url = await storage.createDownloadUrl(a.storageKey, a.fileName);
    if (url) return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
    if (!isLocalStorage(storage)) throw notFoundError("Attachment");
    const file = await storage.read(a.storageKey);
    if (!file) throw notFoundError("Attachment");
    return new Response(file.stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": attachmentDisposition(a.fileName),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
