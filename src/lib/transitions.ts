import { ruleViolation } from "@/lib/errors";
import type { ISODate } from "@/lib/dates";
import type { MilestoneProgressMode, MilestoneStatus, TaskStatus } from "@/lib/progress";

/**
 * Status-transition rules, kept pure so they are unit tested and shared by every code path.
 *
 * TASKS
 *  - Any status may move to any other status (the Kanban board allows free movement) EXCEPT that a
 *    task can only become `done` when every task it depends on is `done` and all of its own
 *    subtasks are `done`.
 *  - Becoming `done` stamps completedAt; leaving `done` clears it.
 * MILESTONES
 *  - In `calculated` mode the status follows its tasks: when every task is done it becomes
 *    `completed` (stamping actualDate); if a completed milestone gets an open task again it goes
 *    back to `in_progress`. `at_risk` is a manual flag that is cleared by completion.
 *  - A milestone can only be set to `completed` manually when its progress is 100% (calculated mode
 *    with tasks, or manual mode at 100%). A calculated milestone with no tasks may be completed freely.
 * PROJECTS
 *  - Moving to `in_progress` stamps actualStartDate if empty; `completed` stamps actualStartDate/actualEndDate if
 *    empty; leaving `completed` clears actualEndDate.
 */

export interface TaskStatusChangeInput {
  from: TaskStatus;
  to: TaskStatus;
  unfinishedDependencies: number;
  unfinishedSubtasks: number;
  now: Date;
  completedAt: Date | null;
}

export function resolveTaskStatusChange(input: TaskStatusChangeInput): { completedAt: Date | null } {
  const { from, to } = input;
  if (to === "done" && from !== "done") {
    if (input.unfinishedDependencies > 0) {
      throw ruleViolation(
        `Cannot complete this task: ${input.unfinishedDependencies} task(s) it depends on are not done yet.`,
      );
    }
    if (input.unfinishedSubtasks > 0) {
      throw ruleViolation(`Cannot complete this task: ${input.unfinishedSubtasks} subtask(s) are not done yet.`);
    }
    return { completedAt: input.now };
  }
  if (to !== "done") return { completedAt: null };
  return { completedAt: input.completedAt ?? input.now };
}

export interface MilestoneStatusInput {
  to: MilestoneStatus;
  progressMode: MilestoneProgressMode;
  /** Calculated or manual percent from lib/progress. */
  percent: number;
  taskCount: number;
}

/** Throws if a manual status change to `completed` is not allowed. */
export function assertMilestoneStatusChange(input: MilestoneStatusInput): void {
  if (input.to !== "completed") return;
  if (input.progressMode === "manual") {
    if (input.percent < 100) throw ruleViolation("Set manual progress to 100% before completing this milestone.");
    return;
  }
  if (input.taskCount > 0 && input.percent < 100) {
    throw ruleViolation("All tasks must be done before this milestone can be completed.");
  }
}

export interface MilestoneSyncInput {
  status: MilestoneStatus;
  progressMode: MilestoneProgressMode;
  percent: number;
  taskCount: number;
  anyStarted: boolean;
  actualDate: ISODate | null;
  today: ISODate;
}

/**
 * Re-derives a calculated milestone's status after its tasks changed. Returns null when no change
 * is needed (manual mode, or no tasks to derive from).
 */
export function syncCalculatedMilestone(
  input: MilestoneSyncInput,
): { status: MilestoneStatus; actualDate: ISODate | null } | null {
  if (input.progressMode !== "calculated" || input.taskCount === 0) return null;
  if (input.percent >= 100) {
    return input.status === "completed" ? null : { status: "completed", actualDate: input.actualDate ?? input.today };
  }
  if (input.status === "completed") {
    return { status: input.anyStarted ? "in_progress" : "not_started", actualDate: null };
  }
  if (input.status === "not_started" && input.anyStarted) return { status: "in_progress", actualDate: input.actualDate };
  return null;
}

export type ProjectStatus = "planning" | "not_started" | "in_progress" | "on_hold" | "completed" | "cancelled";

export function projectStatusEffects(
  prev: { status: ProjectStatus; actualStartDate: ISODate | null; actualEndDate: ISODate | null },
  next: ProjectStatus,
  today: ISODate,
): { actualStartDate: ISODate | null; actualEndDate: ISODate | null } {
  let { actualStartDate, actualEndDate } = prev;
  if (next === "in_progress" && !actualStartDate) actualStartDate = today;
  if (next === "completed") {
    actualStartDate ??= today;
    actualEndDate ??= today;
  } else if (prev.status === "completed") {
    actualEndDate = null;
  }
  return { actualStartDate, actualEndDate };
}
