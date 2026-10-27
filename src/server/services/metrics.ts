import type { schema } from "@/db";
import { daysBetween, isOverdue, type ISODate } from "@/lib/dates";
import {
  type MilestoneProgress,
  type ProgressMilestone,
  type ProgressTask,
  type TaskCounts,
  leafTasks,
  projectProgress,
} from "@/lib/progress";
import { type HealthLevel, type HealthResult, computeHealth } from "@/lib/progress/health";

type ProjectRow = typeof schema.projects.$inferSelect;
type MilestoneRow = typeof schema.milestones.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;
type RiskRow = typeof schema.risks.$inferSelect;

export function toProgressTask(t: Pick<TaskRow, "id" | "status" | "progress" | "estimateHours" | "parentTaskId" | "milestoneId">): ProgressTask {
  return {
    id: t.id,
    status: t.status,
    progress: t.progress,
    estimateHours: t.estimateHours === null ? null : Number(t.estimateHours),
    parentTaskId: t.parentTaskId,
    milestoneId: t.milestoneId,
  };
}

export function toProgressMilestone(m: Pick<MilestoneRow, "id" | "status" | "progressMode" | "manualProgress">): ProgressMilestone {
  return { id: m.id, status: m.status, progressMode: m.progressMode, manualProgress: m.manualProgress };
}

export interface ProjectMetrics {
  progress: number;
  counts: TaskCounts;
  milestones: Record<string, MilestoneProgress>;
  unassigned: MilestoneProgress | null;
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  totalMilestones: number;
  completedMilestones: number;
  overdueMilestones: number;
  openCriticalRisks: number;
  overdueCriticalRisks: number;
  /** Days until the planned end date; negative when past. */
  daysRemaining: number;
  daysOverdue: number;
  computedHealth: HealthResult;
  /** Manual override if set, otherwise the computed value. Null for completed/cancelled projects. */
  health: HealthLevel | null;
  healthIsManual: boolean;
}

const isOpenRisk = (r: Pick<RiskRow, "status">) => r.status === "open" || r.status === "mitigating";
const isCritical = (r: Pick<RiskRow, "severity">) => r.severity === "critical";

/** Single source of truth for every per-project number shown in lists, dashboards and reports. */
export function computeMetrics(
  project: ProjectRow,
  milestones: MilestoneRow[],
  tasks: TaskRow[],
  risks: RiskRow[],
  today: ISODate,
): ProjectMetrics {
  const progressTasks = tasks.map(toProgressTask);
  const p = projectProgress(milestones.map(toProgressMilestone), progressTasks, project.progressWeighting);

  const leafIds = new Set(leafTasks(progressTasks).map((t) => t.id));
  const openLeaves = tasks.filter((t) => leafIds.has(t.id) && t.status !== "done");
  const overdueTasks = openLeaves.filter((t) => isOverdue(t.dueDate, today)).length;
  const blockedTasks = openLeaves.filter((t) => t.status === "blocked").length;
  const overdueMilestones = milestones.filter((m) => m.status !== "completed" && isOverdue(m.dueDate, today)).length;
  const openCritical = risks.filter((r) => isOpenRisk(r) && isCritical(r));
  const overdueCritical = openCritical.filter((r) => isOverdue(r.targetDate, today)).length;

  const computedHealth = computeHealth({
    status: project.status,
    progress: p.percent,
    startDate: project.startDate,
    plannedEndDate: project.plannedEndDate,
    today,
    openTaskCount: openLeaves.length,
    overdueTaskCount: overdueTasks,
    overdueMilestoneCount: overdueMilestones,
    blockedTaskCount: blockedTasks,
    openCriticalRiskCount: openCritical.length,
    overdueCriticalRiskCount: overdueCritical,
  });
  const closed = project.status === "completed" || project.status === "cancelled";
  const daysRemaining = daysBetween(today, project.plannedEndDate);

  return {
    progress: p.percent,
    counts: p.counts,
    milestones: p.milestones,
    unassigned: p.unassigned,
    openTasks: openLeaves.length,
    overdueTasks,
    blockedTasks,
    totalMilestones: milestones.length,
    completedMilestones: milestones.filter((m) => m.status === "completed").length,
    overdueMilestones,
    openCriticalRisks: openCritical.length,
    overdueCriticalRisks: overdueCritical,
    daysRemaining,
    daysOverdue: !closed && daysRemaining < 0 ? -daysRemaining : 0,
    computedHealth,
    health: closed ? null : (project.health ?? computedHealth.health),
    healthIsManual: !closed && project.health !== null,
  };
}
