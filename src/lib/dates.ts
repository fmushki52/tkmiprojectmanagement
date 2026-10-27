import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

/**
 * Date-only values (start/due dates) are ISO `YYYY-MM-DD` strings end to end, which compare
 * correctly with plain string comparison and never shift with the viewer's timezone.
 */
export type ISODate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(value: string): boolean {
  return ISO_DATE.test(value) && isValid(parseISO(value)) && format(parseISO(value), "yyyy-MM-dd") === value;
}

export function toISODate(date: Date): ISODate {
  return format(date, "yyyy-MM-dd");
}

/** Today's date in the server's local timezone. Pass `today` explicitly in tests. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

export function addDaysISO(date: ISODate, days: number): ISODate {
  const d = parseISO(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** A date-only deadline is overdue once the calendar day after it has begun. */
export function isOverdue(due: ISODate | null | undefined, today: ISODate): boolean {
  return !!due && due < today;
}

export function formatDate(date: ISODate | null | undefined, pattern = "MMM d, yyyy"): string {
  return date ? format(parseISO(date), pattern) : "—";
}
