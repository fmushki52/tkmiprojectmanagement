import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import {
  milestoneProgressMode,
  milestoneStatus,
  priority,
  progressWeighting,
  projectHealth,
  projectStatus,
  taskStatus,
} from "./enums";
import { workspaces } from "./workspace";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Dates without a time component (start/due dates) are stored as `date` and
 * handled as ISO `YYYY-MM-DD` strings to avoid timezone drift.
 *
 * Deletion rules: deleting a workspace or project cascades to everything under
 * it. Archiving a project (archived_at) is the reversible alternative. Deleting
 * a user never deletes work: user references on content are SET NULL.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }).notNull().default(""),
    scope: text("scope").notNull().default(""),
    startDate: date("start_date", { mode: "string" }).notNull(),
    plannedEndDate: date("planned_end_date", { mode: "string" }).notNull(),
    actualStartDate: date("actual_start_date", { mode: "string" }),
    actualEndDate: date("actual_end_date", { mode: "string" }),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    status: projectStatus("status").notNull().default("planning"),
    priority: priority("priority").notNull().default("medium"),
    /** Manual health override. NULL means "derive automatically" (see lib/progress/health.ts). */
    health: projectHealth("health"),
    color: varchar("color", { length: 7 }).notNull().default("#6366f1"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    progressWeighting: progressWeighting("progress_weighting").notNull().default("equal"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("projects_workspace_status_idx").on(t.workspaceId, t.status),
    index("projects_workspace_archived_idx").on(t.workspaceId, t.archivedAt),
    check("projects_dates_ck", sql`${t.plannedEndDate} >= ${t.startDate}`),
    check(
      "projects_actual_dates_ck",
      sql`${t.actualStartDate} IS NULL OR ${t.actualEndDate} IS NULL OR ${t.actualEndDate} >= ${t.actualStartDate}`,
    ),
  ],
);

export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("project_members_project_user_uq").on(t.projectId, t.userId),
    index("project_members_user_idx").on(t.userId),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull().default(""),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    actualDate: date("actual_date", { mode: "string" }),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    status: milestoneStatus("status").notNull().default("not_started"),
    priority: priority("priority").notNull().default("medium"),
    /** `calculated` derives completion from tasks; `manual` uses manual_progress. */
    progressMode: milestoneProgressMode("progress_mode").notNull().default("calculated"),
    manualProgress: integer("manual_progress"),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("milestones_project_position_idx").on(t.projectId, t.position),
    index("milestones_workspace_due_idx").on(t.workspaceId, t.dueDate),
    check(
      "milestones_manual_progress_ck",
      sql`${t.manualProgress} IS NULL OR (${t.manualProgress} BETWEEN 0 AND 100)`,
    ),
    check(
      "milestones_manual_mode_ck",
      sql`${t.progressMode} <> 'manual' OR ${t.manualProgress} IS NOT NULL`,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    status: taskStatus("status").notNull().default("todo"),
    priority: priority("priority").notNull().default("medium"),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    estimateHours: numeric("estimate_hours", { precision: 8, scale: 2 }),
    actualHours: numeric("actual_hours", { precision: 8, scale: 2 }),
    /** Optional explicit progress 0-100 for tasks that are not done. */
    progress: integer("progress"),
    /** Order within the (project, status) column on the Kanban board. */
    position: doublePrecision("position").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("tasks_project_status_idx").on(t.projectId, t.status),
    index("tasks_milestone_idx").on(t.milestoneId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_parent_idx").on(t.parentTaskId),
    index("tasks_workspace_due_idx").on(t.workspaceId, t.dueDate),
    check(
      "tasks_dates_ck",
      sql`${t.startDate} IS NULL OR ${t.dueDate} IS NULL OR ${t.dueDate} >= ${t.startDate}`,
    ),
    check("tasks_progress_ck", sql`${t.progress} IS NULL OR (${t.progress} BETWEEN 0 AND 100)`),
    check("tasks_not_own_parent_ck", sql`${t.parentTaskId} IS NULL OR ${t.parentTaskId} <> ${t.id}`),
  ],
);

/** `taskId` cannot be completed before `dependsOnTaskId` is done. */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("task_dependencies_pair_uq").on(t.taskId, t.dependsOnTaskId),
    index("task_dependencies_depends_on_idx").on(t.dependsOnTaskId),
    check("task_dependencies_not_self_ck", sql`${t.taskId} <> ${t.dependsOnTaskId}`),
  ],
);

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 40 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#64748b"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("labels_workspace_name_uq").on(t.workspaceId, t.name)],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("task_labels_label_idx").on(t.labelId),
  ],
);
