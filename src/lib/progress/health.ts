import { daysBetween, type ISODate } from "@/lib/dates";

/**
 * Project health rules. The result is a deterministic function of recorded data; each label comes
 * with the reasons that produced it. A project's stored `health` (if set) is a manual override and
 * is shown instead of the computed value, clearly marked as manual.
 *
 * Not applicable (null): completed or cancelled projects.
 *
 * "Time elapsed" is the share of the schedule between start and planned end that has passed
 * (0 before the start date, 100 on/after the planned end). "Slip" = max(0, time elapsed - progress),
 * in percentage points.
 *
 * OFF TRACK when any of:
 *   - the planned end date has passed and progress < 100
 *   - slip >= 25 points
 *   - an open critical risk/blocker is past its target resolution date
 *
 * AT RISK when not off track and any of:
 *   - slip >= 10 points
 *   - at least one milestone is overdue (due date passed, not completed)
 *   - at least one task is blocked
 *   - an open critical risk/blocker exists
 *   - more than 20% of open tasks are overdue
 *   - the planned end is within 14 days and at least 30% of the work remains (schedule risk)
 *
 * ON TRACK otherwise.
 */
export type HealthLevel = "on_track" | "at_risk" | "off_track";

export interface HealthInput {
  status: "planning" | "not_started" | "in_progress" | "on_hold" | "completed" | "cancelled";
  progress: number;
  startDate: ISODate;
  plannedEndDate: ISODate;
  today: ISODate;
  openTaskCount: number;
  overdueTaskCount: number;
  overdueMilestoneCount: number;
  blockedTaskCount: number;
  openCriticalRiskCount: number;
  overdueCriticalRiskCount: number;
}

export interface HealthResult {
  health: HealthLevel | null;
  reasons: string[];
  timeElapsedPercent: number;
  slipPoints: number;
}

export function timeElapsedPercent(start: ISODate, end: ISODate, today: ISODate): number {
  if (today <= start) return 0;
  if (today >= end) return 100;
  const total = daysBetween(start, end);
  return total <= 0 ? 100 : (daysBetween(start, today) / total) * 100;
}

export const HEALTH_THRESHOLDS = {
  offTrackSlip: 25,
  atRiskSlip: 10,
  overdueTaskShare: 0.2,
  approachingDeadlineDays: 14,
  approachingRemainingPercent: 30,
} as const;

export function computeHealth(input: HealthInput): HealthResult {
  const elapsed = timeElapsedPercent(input.startDate, input.plannedEndDate, input.today);
  const slip = Math.max(0, elapsed - input.progress);
  const base = { timeElapsedPercent: Math.round(elapsed), slipPoints: Math.round(slip) };

  if (input.status === "completed" || input.status === "cancelled") {
    return { health: null, reasons: [], ...base };
  }

  const T = HEALTH_THRESHOLDS;
  const daysRemaining = daysBetween(input.today, input.plannedEndDate);
  const off: string[] = [];
  const risk: string[] = [];

  if (input.today > input.plannedEndDate && input.progress < 100) {
    off.push(`Planned end date passed ${Math.abs(daysRemaining)} day(s) ago with ${Math.round(input.progress)}% complete`);
  }
  if (slip >= T.offTrackSlip) {
    off.push(`${Math.round(slip)} points behind schedule (${Math.round(elapsed)}% of time elapsed, ${Math.round(input.progress)}% complete)`);
  }
  if (input.overdueCriticalRiskCount > 0) {
    off.push(`${input.overdueCriticalRiskCount} critical risk(s)/blocker(s) past their target resolution date`);
  }
  if (off.length) return { health: "off_track", reasons: off, ...base };

  if (slip >= T.atRiskSlip) {
    risk.push(`${Math.round(slip)} points behind schedule (${Math.round(elapsed)}% of time elapsed, ${Math.round(input.progress)}% complete)`);
  }
  if (input.overdueMilestoneCount > 0) risk.push(`${input.overdueMilestoneCount} overdue milestone(s)`);
  if (input.blockedTaskCount > 0) risk.push(`${input.blockedTaskCount} blocked task(s)`);
  if (input.openCriticalRiskCount > 0) risk.push(`${input.openCriticalRiskCount} open critical risk(s)/blocker(s)`);
  if (input.openTaskCount > 0 && input.overdueTaskCount / input.openTaskCount > T.overdueTaskShare) {
    risk.push(`${input.overdueTaskCount} of ${input.openTaskCount} open tasks are overdue`);
  }
  if (
    daysRemaining >= 0 &&
    daysRemaining <= T.approachingDeadlineDays &&
    100 - input.progress >= T.approachingRemainingPercent &&
    input.today >= input.startDate
  ) {
    risk.push(`Planned end in ${daysRemaining} day(s) with ${Math.round(100 - input.progress)}% of the work remaining`);
  }
  if (risk.length) return { health: "at_risk", reasons: risk, ...base };

  return { health: "on_track", reasons: [], ...base };
}
