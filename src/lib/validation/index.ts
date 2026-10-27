import { z } from "zod";
import { isValidISODate } from "@/lib/dates";

export const PROJECT_STATUSES = ["planning", "not_started", "in_progress", "on_hold", "completed", "cancelled"] as const;
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const HEALTHS = ["on_track", "at_risk", "off_track"] as const;
export const MILESTONE_STATUSES = ["not_started", "in_progress", "completed", "at_risk"] as const;
export const TASK_STATUSES = ["backlog", "todo", "in_progress", "blocked", "done"] as const;
export const RISK_KINDS = ["risk", "issue", "blocker"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const LIKELIHOODS = ["low", "medium", "high"] as const;
export const RISK_STATUSES = ["open", "mitigating", "accepted", "resolved"] as const;

export const uuid = z.string().uuid("Invalid id");

export const isoDate = z.string().refine(isValidISODate, "Enter a valid date");
/** "" (empty input) -> null, otherwise a valid ISO date. */
export const optionalDate = z.union([isoDate, z.literal("")]).transform((v) => (v === "" ? null : v));
/** "" (empty select) -> null, otherwise a user id. User ids come from Better Auth and are NOT uuids. */
export const optionalUserId = z.union([z.string().min(1).max(64), z.literal("")]).transform((v) => (v === "" ? null : v));
/** "" (empty select) -> null, otherwise a uuid. */
export const optionalId = z.union([uuid, z.literal("")]).transform((v) => (v === "" ? null : v));
/** "" -> null, otherwise a non-negative number (hours). */
export const optionalHours = z
  .union([z.literal(""), z.coerce.number().min(0, "Must be 0 or more").max(100000)])
  .transform((v) => (v === "" ? null : v));
/** "" -> null, otherwise an integer 0-100. */
export const optionalPercent = z
  .union([z.literal(""), z.coerce.number().int("Whole numbers only").min(0).max(100)])
  .transform((v) => (v === "" ? null : v));

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #6366f1");
const trimmed = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} must be ${max} characters or fewer`);
const text = (max: number) => z.string().trim().max(max, `Must be ${max} characters or fewer`);

// ---------------------------------------------------------------- workspace
export const workspaceSchema = z.object({ name: trimmed(80, "Workspace name") });
export const createUserSchema = z.object({
  name: trimmed(80, "Name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
  role: z.enum(["owner", "project_manager", "contributor", "viewer"]),
});
export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["owner", "project_manager", "contributor", "viewer"]),
});

// ---------------------------------------------------------------- project
const projectBase = z.object({
  title: trimmed(160, "Title"),
  description: text(500).default(""),
  scope: text(20000).default(""),
  startDate: isoDate,
  plannedEndDate: isoDate,
  actualStartDate: optionalDate,
  actualEndDate: optionalDate,
  ownerId: optionalUserId,
  status: z.enum(PROJECT_STATUSES),
  priority: z.enum(PRIORITIES),
  /** "" means automatic health. */
  health: z.union([z.enum(HEALTHS), z.literal("")]).transform((v) => (v === "" ? null : v)),
  color: hexColor,
  tags: z
    .string()
    .transform((s) =>
      Array.from(new Set(s.split(",").map((t) => t.trim()).filter(Boolean))).slice(0, 12),
    ),
  progressWeighting: z.enum(["equal", "effort"]),
  memberIds: z.array(uuidOrUserId()).default([]),
});

/** User ids come from Better Auth (text), not UUIDs. */
function uuidOrUserId() {
  return z.string().min(1).max(64);
}

export function refineProjectDates<T extends { startDate: string; plannedEndDate: string; actualStartDate: string | null; actualEndDate: string | null }>(
  v: T,
  ctx: z.RefinementCtx,
) {
  if (v.plannedEndDate < v.startDate) {
    ctx.addIssue({ code: "custom", path: ["plannedEndDate"], message: "End date cannot be before the start date" });
  }
  if (v.actualStartDate && v.actualEndDate && v.actualEndDate < v.actualStartDate) {
    ctx.addIssue({ code: "custom", path: ["actualEndDate"], message: "Actual completion cannot be before actual start" });
  }
}

export const projectSchema = projectBase.superRefine(refineProjectDates);
export type ProjectInput = z.output<typeof projectSchema>;
export type ProjectFormValues = z.input<typeof projectSchema>;

// ---------------------------------------------------------------- milestone
export const milestoneSchema = z
  .object({
    title: trimmed(160, "Title"),
    description: text(5000).default(""),
    dueDate: isoDate,
    actualDate: optionalDate,
    ownerId: optionalUserId,
    status: z.enum(MILESTONE_STATUSES),
    priority: z.enum(PRIORITIES),
    progressMode: z.enum(["calculated", "manual"]),
    manualProgress: optionalPercent,
  })
  .superRefine((v, ctx) => {
    if (v.progressMode === "manual" && v.manualProgress === null) {
      ctx.addIssue({ code: "custom", path: ["manualProgress"], message: "Enter a manual progress value (0-100)" });
    }
  });
export type MilestoneInput = z.output<typeof milestoneSchema>;
export type MilestoneFormValues = z.input<typeof milestoneSchema>;

// ---------------------------------------------------------------- task
export const taskSchema = z
  .object({
    title: trimmed(200, "Title"),
    description: text(20000).default(""),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(PRIORITIES),
    assigneeId: z.string().max(64),
    milestoneId: optionalId,
    parentTaskId: optionalId,
    startDate: optionalDate,
    dueDate: optionalDate,
    estimateHours: optionalHours,
    actualHours: optionalHours,
    progress: optionalPercent,
    labels: z
      .string()
      .transform((s) => Array.from(new Set(s.split(",").map((t) => t.trim()).filter(Boolean))).slice(0, 10)),
    dependsOn: z.array(uuid).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.startDate && v.dueDate && v.dueDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Due date cannot be before the start date" });
    }
  })
  .transform((v) => ({ ...v, assigneeId: v.assigneeId === "" ? null : v.assigneeId }));
export type TaskInput = z.output<typeof taskSchema>;
export type TaskFormValues = z.input<typeof taskSchema>;

export const quickTaskSchema = z.object({
  title: trimmed(200, "Title"),
  milestoneId: optionalId,
  status: z.enum(TASK_STATUSES).default("todo"),
});

// ---------------------------------------------------------------- collaboration
export const projectUpdateSchema = z.object({
  title: trimmed(200, "Title"),
  status: z.enum(PROJECT_STATUSES),
  health: z.enum(HEALTHS),
  progressSummary: text(10000).default(""),
  completedWork: text(10000).default(""),
  nextSteps: text(10000).default(""),
  risksBlockers: text(10000).default(""),
  decisions: text(10000).default(""),
});
export type ProjectUpdateInput = z.output<typeof projectUpdateSchema>;
export type ProjectUpdateFormValues = z.input<typeof projectUpdateSchema>;

export const commentSchema = z.object({ body: trimmed(5000, "Comment") });

export const riskSchema = z.object({
  kind: z.enum(RISK_KINDS),
  title: trimmed(200, "Title"),
  description: text(10000).default(""),
  severity: z.enum(SEVERITIES),
  likelihood: z.enum(LIKELIHOODS),
  ownerId: z.string().max(64).transform((v) => (v === "" ? null : v)),
  mitigation: text(10000).default(""),
  status: z.enum(RISK_STATUSES),
  targetDate: optionalDate,
});
export type RiskInput = z.output<typeof riskSchema>;
export type RiskFormValues = z.input<typeof riskSchema>;

// ---------------------------------------------------------------- profile
export const profileSchema = z.object({ name: trimmed(80, "Name") });

export const signUpSchema = z.object({
  name: trimmed(80, "Name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});
export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

/** Flattens a ZodError into `{ field: [messages] }`. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
