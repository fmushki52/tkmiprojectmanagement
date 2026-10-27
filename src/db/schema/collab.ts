import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import {
  likelihood,
  notificationType,
  projectHealth,
  projectStatus,
  riskKind,
  riskStatus,
  severity,
} from "./enums";
import { milestones, projects, tasks } from "./project";
import { workspaces } from "./workspace";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * Published project updates are append-only. Editing publishes a NEW row with
 * `supersedes_id` pointing at the previous revision (the old row stays and is
 * marked superseded). Deleting is a soft "retract" with actor + reason; the row
 * is never removed. Both are written to activity_logs.
 */
export const projectUpdates = pgTable(
  "project_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    status: projectStatus("status").notNull(),
    health: projectHealth("health").notNull(),
    progressSummary: text("progress_summary").notNull().default(""),
    completedWork: text("completed_work").notNull().default(""),
    nextSteps: text("next_steps").notNull().default(""),
    risksBlockers: text("risks_blockers").notNull().default(""),
    decisions: text("decisions").notNull().default(""),
    /** Calculated project completion (0-100) at publish time: a real historical data point. */
    progressSnapshot: integer("progress_snapshot").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => projectUpdates.id, {
      onDelete: "restrict",
    }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    retractedAt: timestamp("retracted_at", { withTimezone: true }),
    retractedById: text("retracted_by_id").references(() => user.id, { onDelete: "set null" }),
    retractReason: text("retract_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("project_updates_project_created_idx").on(t.projectId, t.createdAt)],
);

/** A comment targets exactly one of: task, milestone, project update. Replies set parent_id. */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "cascade" }),
    updateId: uuid("update_id").references(() => projectUpdates.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("comments_task_idx").on(t.taskId),
    index("comments_milestone_idx").on(t.milestoneId),
    index("comments_update_idx").on(t.updateId),
    check(
      "comments_single_target_ck",
      sql`(CASE WHEN ${t.taskId} IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN ${t.milestoneId} IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN ${t.updateId} IS NOT NULL THEN 1 ELSE 0 END) = 1`,
    ),
  ],
);

/** Append-only audit/activity trail. Application code only ever inserts. */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id"),
    action: varchar("action", { length: 60 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_project_created_idx").on(t.projectId, t.createdAt),
    index("activity_workspace_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const risks = pgTable(
  "risks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: riskKind("kind").notNull().default("risk"),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    severity: severity("severity").notNull().default("medium"),
    likelihood: likelihood("likelihood").notNull().default("medium"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    mitigation: text("mitigation").notNull().default(""),
    status: riskStatus("status").notNull().default("open"),
    targetDate: date("target_date", { mode: "string" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("risks_project_status_idx").on(t.projectId, t.status)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull().default(""),
    /** Path inside the app, e.g. /w/acme/projects/<id>. */
    link: text("link"),
    /** Prevents duplicate generated notifications (e.g. one overdue notice per task per day). */
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_read_idx").on(t.userId, t.readAt, t.createdAt),
    unique("notifications_user_dedupe_uq").on(t.userId, t.dedupeKey),
  ],
);

/**
 * Metadata only. File bytes live in object storage; `storage_key` is the object key.
 * `uploaded_at` is NULL while the upload is pending and is set once the server has verified the
 * stored object (existence + size). Pending rows are never listed or downloadable.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    uploadedById: text("uploaded_by_id").references(() => user.id, { onDelete: "set null" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 120 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_project_idx").on(t.projectId), index("attachments_task_idx").on(t.taskId)],
);
