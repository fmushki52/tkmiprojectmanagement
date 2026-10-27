import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { addDaysISO, todayISO, type ISODate } from "@/lib/dates";
import { assertCan } from "@/lib/permissions";
import { buildBurnup, type BurnupResult } from "@/lib/progress/burnup";
import { leafTasks } from "@/lib/progress";
import type { Ctx } from "../types";
import { type ProjectMetrics, computeMetrics, toProgressTask } from "./metrics";
import { getProjectDetail, loadProjectData } from "./projects";
import { listMembers } from "./workspaces";

const { taskLabels, labels, user, projectUpdates, projects } = schema;

export const REPORT_SECTIONS = ["summary", "milestones", "tasks", "completed", "upcoming", "risks", "updates", "charts", "performance"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const SECTION_LABELS: Record<ReportSection, string> = {
  summary: "Summary & schedule",
  milestones: "Milestones",
  tasks: "Task summary",
  completed: "Completed work",
  upcoming: "Upcoming activities",
  risks: "Risks & blockers",
  updates: "Recent updates",
  charts: "Charts",
  performance: "Planned vs actual",
};

export interface ReportOptions {
  /** Inclusive date range for "completed work" and "updates". Defaults to the last 30 days. */
  from?: ISODate;
  to?: ISODate;
  sections?: ReportSection[];
  today?: ISODate;
}

export function parseReportSections(raw: string | null | undefined): ReportSection[] {
  if (!raw) return [...REPORT_SECTIONS];
  const wanted = new Set(raw.split(","));
  return REPORT_SECTIONS.filter((s) => wanted.has(s));
}

/**
 * Report data comes only from persisted records and goes through the same service/authorization
 * path as the UI, so PDF, CSV and the printable page can never show more than the user may see.
 */
export async function buildReportData(ctx: Ctx, projectId: string, opts: ReportOptions = {}) {
  assertCan(ctx.role, "export:project");
  const db = getDb();
  const today = opts.today ?? todayISO();
  const to = opts.to ?? today;
  const from = opts.from ?? addDaysISO(to, -30);
  const { project, members, owner } = await getProjectDetail(ctx, projectId);
  const { milestones, tasks, risks } = await loadProjectData(db, ctx.workspaceId, projectId);
  const metrics = computeMetrics(project, milestones, tasks, risks, today);

  // Names come from this workspace's members only.
  const names = new Map((await listMembers(ctx)).map((m) => [m.userId, m.name] as const));
  const labelRows = tasks.length
    ? await db
        .select({ taskId: taskLabels.taskId, name: labels.name })
        .from(taskLabels)
        .innerJoin(labels, eq(labels.id, taskLabels.labelId))
        .where(inArray(taskLabels.taskId, tasks.map((t) => t.id)))
    : [];
  const msTitle = new Map(milestones.map((m) => [m.id, m.title]));
  const taskRows = tasks
    .map((t) => ({
      task: t,
      assignee: t.assigneeId ? (names.get(t.assigneeId) ?? null) : null,
      milestone: t.milestoneId ? (msTitle.get(t.milestoneId) ?? null) : null,
      labels: labelRows.filter((l) => l.taskId === t.id).map((l) => l.name),
    }))
    .sort((a, b) => (a.task.dueDate ?? "9999").localeCompare(b.task.dueDate ?? "9999") || a.task.title.localeCompare(b.task.title));

  const leafIds = new Set(leafTasks(tasks.map(toProgressTask)).map((t) => t.id));
  const completed = taskRows.filter(
    (r) => leafIds.has(r.task.id) && r.task.completedAt && r.task.completedAt.toISOString().slice(0, 10) >= from && r.task.completedAt.toISOString().slice(0, 10) <= to,
  );
  const horizon = addDaysISO(today, 14);
  const upcoming = taskRows.filter((r) => leafIds.has(r.task.id) && r.task.status !== "done" && r.task.dueDate && r.task.dueDate >= today && r.task.dueDate <= horizon);
  const overdue = taskRows.filter((r) => leafIds.has(r.task.id) && r.task.status !== "done" && r.task.dueDate && r.task.dueDate < today);
  const updates = await db
    .select({ update: projectUpdates, authorName: user.name })
    .from(projectUpdates)
    .leftJoin(user, eq(user.id, projectUpdates.authorId))
    .where(and(eq(projectUpdates.projectId, projectId), eq(projectUpdates.workspaceId, ctx.workspaceId), isNull(projectUpdates.supersededAt), isNull(projectUpdates.retractedAt)))
    .orderBy(desc(projectUpdates.createdAt))
    .limit(10);

  const burnup: BurnupResult = buildBurnup(
    tasks.filter((t) => leafIds.has(t.id)).map((t) => ({ dueDate: t.dueDate, completedAt: t.completedAt })),
    project.startDate,
    project.plannedEndDate,
    today,
  );

  return {
    generatedAt: new Date(),
    today,
    range: { from, to },
    sections: opts.sections ?? [...REPORT_SECTIONS],
    project,
    ownerName: owner?.name ?? null,
    memberNames: members.map((m) => m.name),
    metrics,
    milestones: milestones.map((m) => ({ milestone: m, progress: metrics.milestones[m.id], ownerName: m.ownerId ? (names.get(m.ownerId) ?? null) : null })),
    tasks: taskRows,
    completed,
    upcoming,
    overdue,
    risks: risks
      .filter((r) => r.status === "open" || r.status === "mitigating")
      .map((r) => ({ risk: r, ownerName: r.ownerId ? (names.get(r.ownerId) ?? null) : null })),
    updates: updates.map((u) => ({ ...u.update, authorName: u.authorName })),
    burnup,
  };
}
export type ReportData = Awaited<ReturnType<typeof buildReportData>>;

export interface WorkspaceSummaryRow {
  project: typeof projects.$inferSelect;
  ownerName: string | null;
  metrics: ProjectMetrics;
}

/** Workspace-wide portfolio summary: all active projects. Requires the export:workspace capability. */
export async function buildWorkspaceSummary(ctx: Ctx, today: ISODate = todayISO()) {
  assertCan(ctx.role, "export:workspace");
  const db = getDb();
  const rows = await db
    .select({ project: projects, ownerName: user.name })
    .from(projects)
    .leftJoin(user, eq(user.id, projects.ownerId))
    .where(and(eq(projects.workspaceId, ctx.workspaceId), isNull(projects.archivedAt)))
    .orderBy(asc(projects.title));
  const out: WorkspaceSummaryRow[] = [];
  for (const r of rows) {
    const data = await loadProjectData(db, ctx.workspaceId, r.project.id);
    out.push({ ...r, metrics: computeMetrics(r.project, data.milestones, data.tasks, data.risks, today) });
  }
  const [ws] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
  return { generatedAt: new Date(), today, workspaceName: ws.name, rows: out };
}
export type WorkspaceSummary = Awaited<ReturnType<typeof buildWorkspaceSummary>>;
