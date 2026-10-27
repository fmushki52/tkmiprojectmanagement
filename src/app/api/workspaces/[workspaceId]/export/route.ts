import { workspaceCsv } from "@/lib/exports/csv";
import { renderWorkspacePdf } from "@/lib/exports/pdf";
import { errorResponse } from "@/server/http";
import { getCtxByWorkspaceId } from "@/server/context";
import { buildWorkspaceSummary } from "@/server/services/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/workspaces/:id/export?format=pdf|csv — portfolio summary; needs the export:workspace capability. */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const format = new URL(request.url).searchParams.get("format") ?? "pdf";
    const ctx = await getCtxByWorkspaceId(workspaceId);
    const summary = await buildWorkspaceSummary(ctx);
    const base = `portfolio-${summary.today}`;
    if (format === "csv") {
      return new Response(workspaceCsv(summary), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "private, no-store" },
      });
    }
    if (format !== "pdf") return Response.json({ error: "Unknown format." }, { status: 400 });
    return new Response(Buffer.from(await renderWorkspacePdf(summary)), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"`, "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
