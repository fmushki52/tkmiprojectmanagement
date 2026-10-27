import { milestonesCsv, tasksCsv } from "@/lib/exports/csv";
import { renderProjectPdf } from "@/lib/exports/pdf";
import { isValidISODate } from "@/lib/dates";
import { errorResponse } from "@/server/http";
import { getCtxByProjectId } from "@/server/context";
import { buildReportData, parseReportSections } from "@/server/services/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fileSafe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "project";

/**
 * GET /api/projects/:id/export?format=pdf|tasks-csv|milestones-csv&from=&to=&sections=a,b
 * Authorization: the project's workspace is looked up, then the caller's membership AND the
 * export:project capability are verified before any data is read. Only real DB records are used.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "pdf";
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;
    if ((from && !isValidISODate(from)) || (to && !isValidISODate(to))) {
      return Response.json({ error: "Invalid date range." }, { status: 400 });
    }
    if (from && to && to < from) return Response.json({ error: "The end of the range is before its start." }, { status: 400 });
    const ctx = await getCtxByProjectId(projectId);
    const data = await buildReportData(ctx, projectId, { from, to, sections: parseReportSections(url.searchParams.get("sections")) });
    const base = `${fileSafe(data.project.title)}-${data.today}`;

    if (format === "tasks-csv" || format === "milestones-csv") {
      const body = format === "tasks-csv" ? tasksCsv(data) : milestonesCsv(data);
      return new Response(body, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${base}-${format === "tasks-csv" ? "tasks" : "milestones"}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (format !== "pdf") return Response.json({ error: "Unknown format." }, { status: 400 });
    const pdf = await renderProjectPdf(data);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}-report.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
