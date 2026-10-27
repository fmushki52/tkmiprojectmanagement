import { errorResponse } from "@/server/http";
import { purgePendingAttachments } from "@/server/services/attachments";
import { syncAllDeadlineNotifications } from "@/server/services/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled by Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * Creates "due soon" and "overdue" in-app notifications (idempotent via dedupe keys) and discards
 * uploads that were requested but never confirmed.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const created = await syncAllDeadlineNotifications();
    const purged = await purgePendingAttachments();
    return Response.json({ created, purgedPendingUploads: purged });
  } catch (e) {
    return errorResponse(e);
  }
}
