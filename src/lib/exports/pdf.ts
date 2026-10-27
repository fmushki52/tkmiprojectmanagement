import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { formatDate } from "@/lib/dates";
import { type TaskStatus, taskProgress } from "@/lib/progress";
import type { ReportData, WorkspaceSummary } from "@/server/services/reports";

/**
 * PDF generation with pdf-lib: pure JavaScript, no native binaries, no filesystem or font files, so
 * it runs unchanged in Vercel's Node.js runtime. Uses the built-in Helvetica fonts (WinAnsi), so any
 * character outside that set is replaced with "?" rather than failing the export.
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.1, 0.11, 0.14);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.86, 0.88, 0.91);
const TRACK = rgb(0.9, 0.92, 0.95);
const ACCENT = rgb(0.06, 0.43, 0.34); // brand emerald #0F6E56
const STATUS_COLORS: Record<TaskStatus, ReturnType<typeof rgb>> = {
  backlog: rgb(0.6, 0.64, 0.7),
  todo: rgb(0.38, 0.5, 0.8),
  in_progress: rgb(0.95, 0.65, 0.1),
  blocked: rgb(0.86, 0.25, 0.25),
  done: rgb(0.13, 0.66, 0.4),
};
const HEALTH_COLORS = { on_track: rgb(0.13, 0.66, 0.4), at_risk: rgb(0.95, 0.65, 0.1), off_track: rgb(0.86, 0.25, 0.25) };

const label = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

class Pdf {
  doc!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  private charset!: Set<number>;

  static async create(title: string) {
    const p = new Pdf();
    p.doc = await PDFDocument.create();
    p.doc.setTitle(title);
    p.doc.setCreator("Project Tracker");
    p.font = await p.doc.embedFont(StandardFonts.Helvetica);
    p.bold = await p.doc.embedFont(StandardFonts.HelveticaBold);
    p.charset = new Set(p.font.getCharacterSet());
    p.newPage();
    return p;
  }

  clean(text: string): string {
    return Array.from(text.replace(/\r\n?/g, "\n").replace(/\t/g, "  "))
      .map((c) => (c === "\n" || this.charset.has(c.codePointAt(0)!) ? c : "?"))
      .join("");
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 18) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of this.clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        let w = word;
        // Hard-split words wider than the column.
        while (font.widthOfTextAtSize(w, size) > width) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          if (line) { lines.push(line); line = ""; }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const next = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) <= width) line = next;
        else { lines.push(line); line = w; }
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? MARGIN;
    const lines = this.wrap(text, font, size, opts.width ?? CONTENT_W - (x - MARGIN));
    for (const l of lines) {
      this.ensure(size * 1.4);
      this.y -= size * 1.25;
      this.page.drawText(l, { x, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 3;
  }

  title(text: string) {
    this.text(text, { size: 20, bold: true, gap: 2 });
  }

  section(text: string) {
    this.ensure(40);
    this.y -= 10;
    this.text(text, { size: 12.5, bold: true, gap: 2 });
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.75, color: RULE });
    this.y -= 6;
  }

  keyValues(pairs: [string, string][], columns = 2) {
    const colW = CONTENT_W / columns;
    for (let i = 0; i < pairs.length; i += columns) {
      this.ensure(30);
      const top = this.y;
      let used = 0;
      pairs.slice(i, i + columns).forEach(([k, v], c) => {
        const x = MARGIN + c * colW;
        this.y = top;
        this.text(k.toUpperCase(), { size: 7, color: MUTED, x, width: colW - 8, gap: 0 });
        this.text(v || "—", { size: 10, bold: true, x, width: colW - 8, gap: 2 });
        used = Math.max(used, top - this.y);
      });
      this.y = top - used - 4;
    }
  }

  bar(x: number, y: number, w: number, h: number, pct: number, color = ACCENT) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: TRACK });
    const fill = (Math.max(0, Math.min(100, pct)) / 100) * w;
    if (fill > 0) this.page.drawRectangle({ x, y, width: fill, height: h, color });
  }

  progress(name: string, pct: number, suffix = "", color = ACCENT) {
    this.ensure(22);
    const labelW = 190;
    this.y -= 14;
    this.page.drawText(this.truncate(name, this.font, 9, labelW - 8), { x: MARGIN, y: this.y, size: 9, font: this.font, color: INK });
    this.bar(MARGIN + labelW, this.y - 1, CONTENT_W - labelW - 90, 9, pct, color);
    this.page.drawText(`${Math.round(pct)}%${suffix ? `  ${suffix}` : ""}`, { x: PAGE_W - MARGIN - 82, y: this.y, size: 9, font: this.bold, color: INK });
    this.y -= 4;
  }

  truncate(text: string, font: PDFFont, size: number, width: number): string {
    let t = this.clean(text).replace(/\n/g, " ");
    if (font.widthOfTextAtSize(t, size) <= width) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`.replace("…", "..."), size) > width) t = t.slice(0, -1);
    return `${t}...`;
  }

  table(columns: { header: string; width: number; align?: "right" }[], rows: string[][], emptyText = "None.") {
    const scale = CONTENT_W / columns.reduce((a, c) => a + c.width, 0);
    const widths = columns.map((c) => c.width * scale);
    const drawHeader = () => {
      this.ensure(30);
      this.y -= 12;
      let x = MARGIN;
      columns.forEach((c, i) => {
        const w = this.bold.widthOfTextAtSize(c.header, 8);
        this.page.drawText(c.header, { x: c.align === "right" ? x + widths[i] - 6 - w : x + 2, y: this.y, size: 8, font: this.bold, color: MUTED });
        x += widths[i];
      });
      this.y -= 4;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.75, color: RULE });
    };
    if (!rows.length) return this.text(emptyText, { color: MUTED, size: 9 });
    drawHeader();
    for (const row of rows) {
      if (this.y - 16 < MARGIN + 18) { this.newPage(); drawHeader(); }
      this.y -= 13;
      let x = MARGIN;
      row.forEach((cell, i) => {
        const t = this.truncate(cell, this.font, 8.5, widths[i] - 8);
        const w = this.font.widthOfTextAtSize(t, 8.5);
        this.page.drawText(t, { x: columns[i].align === "right" ? x + widths[i] - 6 - w : x + 2, y: this.y, size: 8.5, font: this.font, color: INK });
        x += widths[i];
      });
      this.y -= 3;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.4, color: RULE });
    }
    this.y -= 4;
  }

  stackedBar(segments: { label: string; value: number; color: ReturnType<typeof rgb> }[]) {
    const total = segments.reduce((a, s) => a + s.value, 0);
    this.ensure(48);
    if (total === 0) return this.text("No tasks yet.", { color: MUTED, size: 9 });
    this.y -= 16;
    let x = MARGIN;
    for (const s of segments) {
      const w = (s.value / total) * CONTENT_W;
      if (w > 0) this.page.drawRectangle({ x, y: this.y, width: w, height: 14, color: s.color });
      x += w;
    }
    this.y -= 8;
    let lx = MARGIN;
    for (const s of segments) {
      const t = `${s.label}: ${s.value}`;
      const need = 14 + this.font.widthOfTextAtSize(t, 8) + 14;
      if (lx + need > PAGE_W - MARGIN) { lx = MARGIN; this.y -= 12; }
      this.y -= lx === MARGIN ? 12 : 0;
      this.page.drawRectangle({ x: lx, y: this.y, width: 8, height: 8, color: s.color });
      this.page.drawText(t, { x: lx + 12, y: this.y, size: 8, font: this.font, color: INK });
      lx += need;
    }
    this.y -= 6;
  }

  lineChart(points: { x: string; planned: number; actual: number | null }[]) {
    const h = 130;
    this.ensure(h + 40);
    const left = MARGIN + 28;
    const w = CONTENT_W - 36;
    const top = this.y - 8;
    const bottom = top - h;
    for (const v of [0, 25, 50, 75, 100]) {
      const yy = bottom + (v / 100) * h;
      this.page.drawLine({ start: { x: left, y: yy }, end: { x: left + w, y: yy }, thickness: 0.4, color: RULE });
      this.page.drawText(`${v}%`, { x: MARGIN, y: yy - 3, size: 7, font: this.font, color: MUTED });
    }
    const px = (i: number) => left + (points.length === 1 ? 0 : (i / (points.length - 1)) * w);
    const py = (v: number) => bottom + (v / 100) * h;
    const draw = (get: (p: (typeof points)[number]) => number | null, color: ReturnType<typeof rgb>) => {
      let prev: { x: number; y: number } | null = null;
      points.forEach((p, i) => {
        const v = get(p);
        if (v === null) { prev = null; return; }
        const cur = { x: px(i), y: py(v) };
        if (prev) this.page.drawLine({ start: prev, end: cur, thickness: 1.75, color });
        this.page.drawCircle({ x: cur.x, y: cur.y, size: 2, color });
        prev = cur;
      });
    };
    draw((p) => p.planned, rgb(0.6, 0.64, 0.7));
    draw((p) => p.actual, ACCENT);
    const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
    for (const i of new Set(ticks)) {
      const t = formatDate(points[i].x, "MMM d");
      this.page.drawText(t, { x: px(i) - this.font.widthOfTextAtSize(t, 7) / 2, y: bottom - 11, size: 7, font: this.font, color: MUTED });
    }
    this.y = bottom - 26;
    this.page.drawRectangle({ x: MARGIN, y: this.y, width: 8, height: 8, color: rgb(0.6, 0.64, 0.7) });
    this.page.drawText("Planned (tasks due by date)", { x: MARGIN + 12, y: this.y, size: 8, font: this.font, color: INK });
    this.page.drawRectangle({ x: MARGIN + 150, y: this.y, width: 8, height: 8, color: ACCENT });
    this.page.drawText("Actual (tasks completed by date)", { x: MARGIN + 162, y: this.y, size: 8, font: this.font, color: INK });
    this.y -= 6;
  }

  async finish(footer: string): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      p.drawText(this.clean(footer), { x: MARGIN, y: 22, size: 7.5, font: this.font, color: MUTED });
      const t = `Page ${i + 1} of ${pages.length}`;
      p.drawText(t, { x: PAGE_W - MARGIN - this.font.widthOfTextAtSize(t, 7.5), y: 22, size: 7.5, font: this.font, color: MUTED });
    });
    return this.doc.save();
  }
}

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

export async function renderProjectPdf(data: ReportData): Promise<Uint8Array> {
  const { project: p, metrics: m } = data;
  const has = (s: ReportData["sections"][number]) => data.sections.includes(s);
  const pdf = await Pdf.create(`${p.title} – project status report`);

  pdf.text("PROJECT STATUS REPORT", { size: 8, bold: true, color: ACCENT, gap: 0 });
  pdf.title(p.title);
  if (p.description) pdf.text(p.description, { color: MUTED, gap: 6 });
  pdf.text(`Generated ${stamp(data.generatedAt)}  ·  Reporting period ${formatDate(data.range.from)} – ${formatDate(data.range.to)}`, { size: 8.5, color: MUTED, gap: 4 });

  if (has("summary")) {
    pdf.section("Summary & schedule");
    pdf.keyValues([
      ["Owner", data.ownerName ?? "Unassigned"],
      ["Status", label(p.status)],
      ["Priority", label(p.priority)],
      ["Health", m.health ? `${label(m.health)}${m.healthIsManual ? " (set manually)" : ""}` : "Not applicable"],
      ["Planned schedule", `${formatDate(p.startDate)} – ${formatDate(p.plannedEndDate)}`],
      ["Actual schedule", p.actualStartDate || p.actualEndDate ? `${formatDate(p.actualStartDate)} – ${formatDate(p.actualEndDate)}` : "Not recorded"],
      ["Days remaining", m.daysOverdue ? `${m.daysOverdue} overdue` : String(Math.max(0, m.daysRemaining))],
      ["Team", data.memberNames.join(", ") || "—"],
    ]);
    pdf.progress("Overall completion", m.progress, `${m.counts.done}/${m.counts.total} tasks`, m.health ? HEALTH_COLORS[m.health] : ACCENT);
    if (m.computedHealth.reasons.length && m.health && !m.healthIsManual) {
      pdf.text(`Why ${label(m.health).toLowerCase()}: ${m.computedHealth.reasons.join("; ")}.`, { size: 8.5, color: MUTED });
    }
    pdf.keyValues([
      ["Tasks done / total", `${m.counts.done} / ${m.counts.total}`],
      ["Overdue tasks", String(m.overdueTasks)],
      ["Milestones completed", `${m.completedMilestones} / ${m.totalMilestones}`],
      ["Blocked tasks", String(m.blockedTasks)],
    ], 4);
  }

  if (has("charts")) {
    pdf.section("Charts");
    pdf.text("Task status distribution", { bold: true, size: 9 });
    const counts = data.tasks.reduce<Record<TaskStatus, number>>((acc, r) => ((acc[r.task.status] += 1), acc), { backlog: 0, todo: 0, in_progress: 0, blocked: 0, done: 0 });
    pdf.stackedBar((Object.keys(counts) as TaskStatus[]).map((s) => ({ label: label(s), value: counts[s], color: STATUS_COLORS[s] })));
    pdf.text("Milestone completion", { bold: true, size: 9 });
    if (!data.milestones.length) pdf.text("No milestones yet.", { color: MUTED, size: 9 });
    data.milestones.forEach(({ milestone: ms, progress }) => pdf.progress(ms.title, progress?.percent ?? 0, progress?.source === "manual" ? "manual" : ""));
  }

  if (has("milestones")) {
    pdf.section("Milestones");
    pdf.table(
      [{ header: "Milestone", width: 5 }, { header: "Status", width: 2 }, { header: "Due", width: 2 }, { header: "Done", width: 2 }, { header: "Owner", width: 2.5 }, { header: "Progress", width: 1.8, align: "right" }],
      data.milestones.map(({ milestone: ms, progress, ownerName }) => [
        ms.title, label(ms.status), formatDate(ms.dueDate, "MMM d, yy"), formatDate(ms.actualDate, "MMM d, yy"), ownerName ?? "—",
        `${progress?.percent ?? 0}%${progress?.source === "manual" ? " (m)" : ""}`,
      ]),
      "No milestones.",
    );
  }

  if (has("tasks")) {
    pdf.section("Task summary");
    pdf.table(
      [{ header: "Task", width: 6 }, { header: "Status", width: 2 }, { header: "Priority", width: 1.6 }, { header: "Assignee", width: 2.4 }, { header: "Due", width: 1.9 }, { header: "%", width: 1, align: "right" }],
      data.tasks.map((r) => [r.task.title, label(r.task.status), label(r.task.priority), r.assignee ?? "—", formatDate(r.task.dueDate, "MMM d, yy"), String(taskProgress(r.task))]),
      "No tasks.",
    );
  }

  if (has("completed")) {
    pdf.section(`Completed work (${formatDate(data.range.from, "MMM d")} – ${formatDate(data.range.to, "MMM d")})`);
    pdf.table(
      [{ header: "Task", width: 6 }, { header: "Milestone", width: 3 }, { header: "Assignee", width: 2.5 }, { header: "Completed", width: 2 }],
      data.completed.map((r) => [r.task.title, r.milestone ?? "—", r.assignee ?? "—", r.task.completedAt ? formatDate(r.task.completedAt.toISOString().slice(0, 10), "MMM d, yy") : "—"]),
      "No tasks were completed in this period.",
    );
  }

  if (has("upcoming")) {
    pdf.section("Upcoming activities (next 14 days) and overdue");
    pdf.table(
      [{ header: "Task", width: 6 }, { header: "Assignee", width: 2.5 }, { header: "Due", width: 2 }, { header: "State", width: 1.6 }],
      [...data.overdue, ...data.upcoming].map((r) => [r.task.title, r.assignee ?? "—", formatDate(r.task.dueDate, "MMM d, yy"), data.overdue.includes(r) ? "Overdue" : "Upcoming"]),
      "Nothing due or overdue.",
    );
  }

  if (has("risks")) {
    pdf.section("Risks & blockers (open)");
    pdf.table(
      [{ header: "Title", width: 5 }, { header: "Type", width: 1.4 }, { header: "Severity", width: 1.6 }, { header: "Likelihood", width: 1.6 }, { header: "Owner", width: 2.2 }, { header: "Target", width: 1.9 }],
      data.risks.map(({ risk: r, ownerName }) => [r.title, label(r.kind), label(r.severity), label(r.likelihood), ownerName ?? "—", formatDate(r.targetDate, "MMM d, yy")]),
      "No open risks or blockers.",
    );
  }

  if (has("updates")) {
    pdf.section("Recent project updates");
    if (!data.updates.length) pdf.text("No updates published.", { color: MUTED, size: 9 });
    for (const u of data.updates.slice(0, 5)) {
      pdf.text(`${u.title}  —  ${u.authorName ?? "Unknown"}, ${formatDate(u.createdAt.toISOString().slice(0, 10))}  ·  ${label(u.status)}, ${label(u.health)}, ${u.progressSnapshot}% at the time`, { bold: true, size: 9 });
      for (const [k, v] of [["Progress", u.progressSummary], ["Completed", u.completedWork], ["Next steps", u.nextSteps], ["Risks & blockers", u.risksBlockers], ["Decisions", u.decisions]] as const) {
        if (v.trim()) pdf.text(`${k}: ${v}`, { size: 8.5, x: MARGIN + 8, color: INK });
      }
      pdf.y -= 4;
    }
  }

  if (has("performance")) {
    pdf.section("Planned vs actual performance");
    if (!data.burnup.sufficient) {
      pdf.text(`Not enough data to chart planned vs actual: ${data.burnup.reason}`, { color: MUTED, size: 9 });
    } else {
      pdf.lineChart(data.burnup.points.map((pt) => ({ x: pt.date, planned: pt.planned, actual: pt.actual })));
      pdf.text("Shares are of the current task set. Planned = tasks due on or before the date; actual = tasks completed on or before it.", { size: 8, color: MUTED });
    }
    if (m.computedHealth.timeElapsedPercent !== undefined) {
      pdf.text(`Schedule elapsed: ${m.computedHealth.timeElapsedPercent}%  ·  Completion: ${m.progress}%  ·  Slip: ${m.computedHealth.slipPoints} points`, { size: 9 });
    }
  }

  return pdf.finish(`${p.title}  ·  Generated ${stamp(data.generatedAt)}`);
}

export async function renderWorkspacePdf(summary: WorkspaceSummary): Promise<Uint8Array> {
  const pdf = await Pdf.create(`${summary.workspaceName} – portfolio summary`);
  pdf.text("WORKSPACE PORTFOLIO SUMMARY", { size: 8, bold: true, color: ACCENT, gap: 0 });
  pdf.title(summary.workspaceName);
  pdf.text(`Generated ${stamp(summary.generatedAt)}  ·  ${summary.rows.length} active project(s)`, { size: 8.5, color: MUTED, gap: 4 });

  const rows = summary.rows;
  const tasksDone = rows.reduce((a, r) => a + r.metrics.counts.done, 0);
  const tasksTotal = rows.reduce((a, r) => a + r.metrics.counts.total, 0);
  pdf.section("Overview");
  pdf.keyValues([
    ["Projects", String(rows.length)],
    ["On track / at risk / off track", ["on_track", "at_risk", "off_track"].map((h) => rows.filter((r) => r.metrics.health === h).length).join(" / ")],
    ["Tasks done / total", `${tasksDone} / ${tasksTotal}`],
    ["Overdue tasks", String(rows.reduce((a, r) => a + r.metrics.overdueTasks, 0))],
  ], 4);

  pdf.section("Projects");
  pdf.table(
    [{ header: "Project", width: 5 }, { header: "Status", width: 2 }, { header: "Health", width: 1.8 }, { header: "Owner", width: 2.4 }, { header: "Planned end", width: 2 }, { header: "Tasks", width: 1.4, align: "right" }, { header: "Progress", width: 1.6, align: "right" }],
    rows.map(({ project: pr, ownerName, metrics: m }) => [pr.title, label(pr.status), m.health ? label(m.health) : "—", ownerName ?? "—", formatDate(pr.plannedEndDate, "MMM d, yy"), `${m.counts.done}/${m.counts.total}`, `${m.progress}%`]),
    "No active projects.",
  );
  pdf.section("Completion by project");
  rows.forEach(({ project: pr, metrics: m }) => pdf.progress(pr.title, m.progress, "", m.health ? HEALTH_COLORS[m.health] : ACCENT));
  return pdf.finish(`${summary.workspaceName}  ·  Generated ${stamp(summary.generatedAt)}`);
}
