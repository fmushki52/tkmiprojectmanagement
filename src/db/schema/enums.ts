import { pgEnum } from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", [
  "owner",
  "project_manager",
  "contributor",
  "viewer",
]);

export const projectStatus = pgEnum("project_status", [
  "planning",
  "not_started",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
]);

export const priority = pgEnum("priority", ["low", "medium", "high", "critical"]);

export const projectHealth = pgEnum("project_health", ["on_track", "at_risk", "off_track"]);

export const progressWeighting = pgEnum("progress_weighting", ["equal", "effort"]);

export const milestoneStatus = pgEnum("milestone_status", [
  "not_started",
  "in_progress",
  "completed",
  "at_risk",
]);

export const milestoneProgressMode = pgEnum("milestone_progress_mode", ["calculated", "manual"]);

export const taskStatus = pgEnum("task_status", [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "done",
]);

export const riskKind = pgEnum("risk_kind", ["risk", "issue", "blocker"]);

export const severity = pgEnum("severity", ["low", "medium", "high", "critical"]);

export const likelihood = pgEnum("likelihood", ["low", "medium", "high"]);

export const riskStatus = pgEnum("risk_status", ["open", "mitigating", "accepted", "resolved"]);

export const notificationType = pgEnum("notification_type", [
  "task_assigned",
  "mention",
  "comment",
  "deadline_upcoming",
  "task_overdue",
  "milestone_completed",
  "project_status_changed",
]);
