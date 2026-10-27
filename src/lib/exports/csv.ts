import { isOverdue } from "@/lib/dates";
import { taskProgress } from "@/lib/progress";
import type { ReportData, WorkspaceSummary } from "@/server/services/reports";

type Cell = string | number | boolean | null | undefined;

/**
 * RFC 4180 CSV: CRLF line breaks, quotes doubled, fields with commas/quotes/newlines quoted.
 * Text cells that start with = + - @ (or a tab/CR) get a leading apostrophe so spreadsheet apps
 * cannot interpret user-entered titles as formulas (CSV injection). Numbers are never altered.
 * A UTF-8 BOM is prepended so Excel detects the encoding.
 */
export function toCsv(rows: Cell[][]): string {
  const esc = (cell: Cell): string => {
    if (cell === null || cell === undefined) return "";
    let s = typeof cell === "string" ? cell : String(cell);
    if (typeof cell === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

const label = (s: string) => s.replaceAll("_", " ");
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export function tasksCsv(data: ReportData): string {
  const header = ["Task ID", "Title", "Status", "Priority", "Assignee", "Milestone", "Parent task ID", "Start date", "Due date", "Overdue", "Estimate (h)", "Actual (h)", "Progress %", "Labels", "Completed on"];
  const rows = data.tasks.map((r) => [
    r.task.id,
    r.task.title,
    label(r.task.status),
    r.task.priority,
    r.assignee ?? "",
    r.milestone ?? "",
    r.task.parentTaskId ?? "",
    r.task.startDate ?? "",
    r.task.dueDate ?? "",
    r.task.status !== "done" && isOverdue(r.task.dueDate, data.today) ? "yes" : "no",
    r.task.estimateHours ?? "",
    r.task.actualHours ?? "",
    taskProgress(r.task),
    r.labels.join("; "),
    day(r.task.completedAt),
  ]);
  return toCsv([header, ...rows]);
}

export function milestonesCsv(data: ReportData): string {
  const header = ["Milestone ID", "Title", "Status", "Priority", "Owner", "Due date", "Actual date", "Overdue", "Progress %", "Progress source", "Tasks", "Tasks done"];
  const rows = data.milestones.map(({ milestone: m, progress, ownerName }) => [
    m.id,
    m.title,
    label(m.status),
    m.priority,
    ownerName ?? "",
    m.dueDate,
    m.actualDate ?? "",
    m.status !== "completed" && isOverdue(m.dueDate, data.today) ? "yes" : "no",
    progress?.percent ?? 0,
    progress?.source ?? "calculated",
    progress?.counts.total ?? 0,
    progress?.counts.done ?? 0,
  ]);
  return toCsv([header, ...rows]);
}

export function workspaceCsv(summary: WorkspaceSummary): string {
  const header = ["Project ID", "Project", "Status", "Priority", "Health", "Owner", "Start date", "Planned end", "Progress %", "Tasks done", "Tasks total", "Overdue tasks", "Milestones done", "Milestones total", "Open critical risks"];
  const rows = summary.rows.map(({ project: p, ownerName, metrics: m }) => [
    p.id, p.title, label(p.status), p.priority, m.health ? label(m.health) : "", ownerName ?? "", p.startDate, p.plannedEndDate,
    m.progress, m.counts.done, m.counts.total, m.overdueTasks, m.completedMilestones, m.totalMilestones, m.openCriticalRisks,
  ]);
  return toCsv([header, ...rows]);
}
