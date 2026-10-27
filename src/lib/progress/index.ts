/**
 * Progress calculation service. Everything here is pure (no I/O, no clock) so it is shared by
 * the dashboard, reports, exports and notifications and covered by unit tests.
 *
 * RULES
 * 1. Task progress (0-100):
 *    - `done` is always 100.
 *    - Otherwise an explicit `progress` value (0-100) wins when set.
 *    - Otherwise the status default applies: backlog 0, todo 0, in_progress 50, blocked 0.
 * 2. Only LEAF tasks count. A task that has subtasks is represented by its subtasks, so work is
 *    never double counted. Task counts (done / remaining / ratio) use the same leaf set.
 * 3. Weighting is `equal` or `effort`. In effort mode a task's weight is its estimate in hours.
 *    Tasks without an estimate get the mean of the known estimates; if no task has an estimate,
 *    weighting falls back to equal.
 * 4. Milestone completion = weighted average of its tasks' progress when `progressMode` is
 *    `calculated` (the default). In `manual` mode the stored manual value is used and the result
 *    is flagged `source: "manual"` so the UI can distinguish it. A calculated milestone with no
 *    tasks has no data: it reports 0%, or 100% if its status is already `completed`.
 * 5. Project completion = weighted average of milestone completion. Tasks that belong to no
 *    milestone form one implicit "unassigned" bucket that counts as one milestone, but only if
 *    such tasks exist. In effort mode a milestone's weight is the total weight of its tasks;
 *    milestones without tasks get the mean positive milestone weight (or equal weights when none).
 * 6. Empty inputs never divide by zero: they yield 0.
 */

export type TaskStatus = "backlog" | "todo" | "in_progress" | "blocked" | "done";
export type Weighting = "equal" | "effort";
export type MilestoneProgressMode = "calculated" | "manual";
export type MilestoneStatus = "not_started" | "in_progress" | "completed" | "at_risk";

export interface ProgressTask {
  id: string;
  status: TaskStatus;
  /** Explicit 0-100 progress; ignored for done tasks. */
  progress: number | null;
  estimateHours: number | null;
  parentTaskId: string | null;
  milestoneId: string | null;
}

export interface ProgressMilestone {
  id: string;
  status: MilestoneStatus;
  progressMode: MilestoneProgressMode;
  manualProgress: number | null;
}

export const STATUS_DEFAULT_PROGRESS: Record<TaskStatus, number> = {
  backlog: 0,
  todo: 0,
  in_progress: 50,
  blocked: 0,
  done: 100,
};

const clampPercent = (n: number) => Math.min(100, Math.max(0, n));

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function taskProgress(task: Pick<ProgressTask, "status" | "progress">): number {
  if (task.status === "done") return 100;
  if (task.progress !== null && task.progress !== undefined) return clampPercent(task.progress);
  return STATUS_DEFAULT_PROGRESS[task.status];
}

/** Tasks that no other task lists as its parent. */
export function leafTasks<T extends Pick<ProgressTask, "id" | "parentTaskId">>(tasks: T[]): T[] {
  const parents = new Set(tasks.map((t) => t.parentTaskId).filter((id): id is string => !!id));
  return tasks.filter((t) => !parents.has(t.id));
}

export function weightedAverage(items: { value: number; weight: number }[]): number {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  if (items.length === 0 || total <= 0) return 0;
  return items.reduce((sum, i) => sum + i.value * i.weight, 0) / total;
}

/**
 * Resolves per-task weights. `fallbackMean` lets callers share one mean across several groups
 * (e.g. all tasks in a project) so a milestone's weight is stable regardless of grouping.
 */
export function taskWeights(
  tasks: Pick<ProgressTask, "estimateHours">[],
  weighting: Weighting,
  fallbackMean?: number | null,
): number[] {
  if (weighting === "equal") return tasks.map(() => 1);
  const known = tasks.map((t) => t.estimateHours).filter((h): h is number => !!h && h > 0);
  const mean = fallbackMean ?? (known.length ? known.reduce((a, b) => a + b, 0) / known.length : null);
  if (mean === null || mean <= 0) return tasks.map(() => 1);
  return tasks.map((t) => (t.estimateHours && t.estimateHours > 0 ? t.estimateHours : mean));
}

export function meanEstimate(tasks: Pick<ProgressTask, "estimateHours">[]): number | null {
  const known = tasks.map((t) => t.estimateHours).filter((h): h is number => !!h && h > 0);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

export interface TaskCounts {
  total: number;
  done: number;
  remaining: number;
  inProgress: number;
  blocked: number;
  /** done / total as 0-1 (0 when there are no tasks). */
  ratio: number;
}

export function taskCounts(tasks: Pick<ProgressTask, "id" | "parentTaskId" | "status">[]): TaskCounts {
  const leaves = leafTasks(tasks);
  const done = leaves.filter((t) => t.status === "done").length;
  return {
    total: leaves.length,
    done,
    remaining: leaves.length - done,
    inProgress: leaves.filter((t) => t.status === "in_progress").length,
    blocked: leaves.filter((t) => t.status === "blocked").length,
    ratio: leaves.length ? done / leaves.length : 0,
  };
}

export interface MilestoneProgress {
  /** 0-100, rounded to a whole number. */
  percent: number;
  source: "calculated" | "manual";
  /** False when a calculated milestone has no tasks to derive progress from. */
  hasData: boolean;
  counts: TaskCounts;
  /** Sum of task weights (hours in effort mode, task count in equal mode). Used for project weighting. */
  weight: number;
}

export function milestoneProgress(
  milestone: Pick<ProgressMilestone, "status" | "progressMode" | "manualProgress">,
  tasksOfMilestone: ProgressTask[],
  weighting: Weighting = "equal",
  projectMeanEstimate?: number | null,
): MilestoneProgress {
  const leaves = leafTasks(tasksOfMilestone);
  const counts = taskCounts(tasksOfMilestone);
  const weights = taskWeights(leaves, weighting, projectMeanEstimate);
  const weight = weights.reduce((a, b) => a + b, 0);

  if (milestone.progressMode === "manual") {
    return {
      percent: clampPercent(round(milestone.manualProgress ?? 0)),
      source: "manual",
      hasData: milestone.manualProgress !== null,
      counts,
      weight,
    };
  }
  if (leaves.length === 0) {
    return { percent: milestone.status === "completed" ? 100 : 0, source: "calculated", hasData: false, counts, weight: 0 };
  }
  const percent = weightedAverage(leaves.map((t, i) => ({ value: taskProgress(t), weight: weights[i] })));
  return { percent: round(percent), source: "calculated", hasData: true, counts, weight };
}

export interface ProjectProgress {
  percent: number;
  milestones: Record<string, MilestoneProgress>;
  /** Present only when tasks exist that belong to no milestone. */
  unassigned: MilestoneProgress | null;
  counts: TaskCounts;
}

export function projectProgress(
  milestones: ProgressMilestone[],
  tasks: ProgressTask[],
  weighting: Weighting = "equal",
): ProjectProgress {
  const leaves = leafTasks(tasks);
  const mean = weighting === "effort" ? meanEstimate(leaves) : null;
  const byMilestone = new Map<string | null, ProgressTask[]>();
  for (const t of tasks) {
    const key = t.milestoneId;
    byMilestone.set(key, [...(byMilestone.get(key) ?? []), t]);
  }

  const result: Record<string, MilestoneProgress> = {};
  for (const m of milestones) {
    result[m.id] = milestoneProgress(m, byMilestone.get(m.id) ?? [], weighting, mean);
  }
  const looseTasks = byMilestone.get(null) ?? [];
  const unassigned = looseTasks.length
    ? milestoneProgress({ status: "in_progress", progressMode: "calculated", manualProgress: null }, looseTasks, weighting, mean)
    : null;

  const buckets = [...Object.values(result), ...(unassigned ? [unassigned] : [])];
  const counts = taskCounts(tasks);
  if (buckets.length === 0) return { percent: 0, milestones: result, unassigned, counts };

  let weights = buckets.map(() => 1);
  if (weighting === "effort") {
    const positive = buckets.map((b) => b.weight).filter((w) => w > 0);
    if (positive.length) {
      const fill = positive.reduce((a, b) => a + b, 0) / positive.length;
      weights = buckets.map((b) => (b.weight > 0 ? b.weight : fill));
    }
  }
  const percent = weightedAverage(buckets.map((b, i) => ({ value: b.percent, weight: weights[i] })));
  return { percent: round(percent), milestones: result, unassigned, counts };
}
