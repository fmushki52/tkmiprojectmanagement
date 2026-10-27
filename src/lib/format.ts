import type { HealthLevel } from "@/lib/progress/health";

export const label = (s: string | null | undefined) => (s ? s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : "—");

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

type Tone = "slate" | "blue" | "amber" | "red" | "green" | "violet" | "orange";

/** Badge palettes, AA-contrast in both light and dark themes. */
export const TONE: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  orange: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
};

export const PROJECT_STATUS_TONE: Record<string, Tone> = {
  planning: "violet",
  not_started: "slate",
  in_progress: "blue",
  on_hold: "amber",
  completed: "green",
  cancelled: "red",
};
export const TASK_STATUS_TONE: Record<string, Tone> = {
  backlog: "slate",
  todo: "blue",
  in_progress: "amber",
  blocked: "red",
  done: "green",
};
export const MILESTONE_STATUS_TONE: Record<string, Tone> = {
  not_started: "slate",
  in_progress: "blue",
  completed: "green",
  at_risk: "red",
};
export const PRIORITY_TONE: Record<string, Tone> = { low: "slate", medium: "blue", high: "orange", critical: "red" };
export const HEALTH_TONE: Record<HealthLevel, Tone> = { on_track: "green", at_risk: "amber", off_track: "red" };
export const SEVERITY_TONE = PRIORITY_TONE;
export const RISK_STATUS_TONE: Record<string, Tone> = { open: "red", mitigating: "amber", accepted: "slate", resolved: "green" };

/** Hex colors for charts/SVG (mirrors the badge tones). */
export const CHART_COLORS = {
  backlog: "#94a3b8",
  todo: "#0ea5e9",
  in_progress: "#f59e0b",
  blocked: "#ef4444",
  done: "#10b981",
  planned: "#94a3b8",
  actual: "#0d9488",
} as const;

export const PROJECT_COLORS = ["#0f766e", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#6366f1", "#64748b"];
