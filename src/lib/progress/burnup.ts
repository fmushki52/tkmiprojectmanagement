import { addDaysISO, daysBetween, type ISODate, toISODate } from "@/lib/dates";

/**
 * Planned vs actual completion, built only from recorded task data (no invented history).
 *
 * - Planned at date D = share of leaf tasks whose due date is on/before D.
 * - Actual at date D  = share of leaf tasks whose completion date is on/before D (null after today).
 * Shares are of ALL current leaf tasks, so the series reflects the current task set and is shown
 * with that caveat. Requires at least MIN_DUE_TASKS tasks with due dates and at least one elapsed day.
 */
export const MIN_DUE_TASKS = 2;

export interface BurnupTask {
  dueDate: ISODate | null;
  completedAt: Date | null;
}

export interface BurnupPoint {
  date: ISODate;
  planned: number;
  actual: number | null;
}

export type BurnupResult =
  | { sufficient: true; points: BurnupPoint[] }
  | { sufficient: false; reason: string };

export function buildBurnup(
  leafTasks: BurnupTask[],
  start: ISODate,
  end: ISODate,
  today: ISODate,
  maxPoints = 14,
): BurnupResult {
  const withDue = leafTasks.filter((t) => t.dueDate).length;
  if (withDue < MIN_DUE_TASKS) {
    return { sufficient: false, reason: `Needs at least ${MIN_DUE_TASKS} tasks with due dates.` };
  }
  if (today <= start) return { sufficient: false, reason: "The project has not started yet." };

  const total = leafTasks.length;
  const span = Math.max(1, daysBetween(start, end));
  const step = Math.max(1, Math.ceil(span / (maxPoints - 1)));
  const dates: ISODate[] = [];
  for (let d = start; d < end; d = addDaysISO(d, step)) dates.push(d);
  dates.push(end);
  if (today > start && today < end && !dates.includes(today)) dates.push(today);
  dates.sort();

  const completedDates = leafTasks.map((t) => (t.completedAt ? toISODate(t.completedAt) : null));
  const points = dates.map<BurnupPoint>((date) => ({
    date,
    planned: Math.round((leafTasks.filter((t) => t.dueDate && t.dueDate <= date).length / total) * 100),
    actual:
      date > today
        ? null
        : Math.round((completedDates.filter((c) => c && c <= date).length / total) * 100),
  }));
  return { sufficient: true, points };
}
