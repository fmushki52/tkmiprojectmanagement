import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { type DbOrTx, getDb, schema } from "@/db";
import type { Ctx } from "../types";

const { activityLogs, user } = schema;

export interface ActivityInput {
  projectId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

/** Append-only. Call inside the same transaction as the change it records. */
export async function logActivity(tx: DbOrTx, ctx: Pick<Ctx, "workspaceId" | "userId">, input: ActivityInput) {
  await tx.insert(activityLogs).values({
    workspaceId: ctx.workspaceId,
    projectId: input.projectId ?? null,
    actorId: ctx.userId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    action: input.action,
    metadata: input.metadata ?? {},
  });
}

export async function listProjectActivity(ctx: Ctx, projectId: string, limit = 30) {
  return getDb()
    .select({
      id: activityLogs.id,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      action: activityLogs.action,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
      actorId: activityLogs.actorId,
      actorName: user.name,
    })
    .from(activityLogs)
    .leftJoin(user, eq(user.id, activityLogs.actorId))
    .where(and(eq(activityLogs.workspaceId, ctx.workspaceId), eq(activityLogs.projectId, projectId)))
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);
}

export async function listWorkspaceActivity(ctx: Ctx, projectIds: string[] | null, limit = 20) {
  const filters = [eq(activityLogs.workspaceId, ctx.workspaceId)];
  if (projectIds) filters.push(projectIds.length ? inArray(activityLogs.projectId, projectIds) : isNull(activityLogs.id));
  return getDb()
    .select({
      id: activityLogs.id,
      projectId: activityLogs.projectId,
      entityType: activityLogs.entityType,
      action: activityLogs.action,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
      actorName: user.name,
    })
    .from(activityLogs)
    .leftJoin(user, eq(user.id, activityLogs.actorId))
    .where(and(...filters))
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit);
}

/** Human-readable one-line description of an activity row. */
export function describeActivity(a: { entityType: string; action: string; metadata: Record<string, unknown> }): string {
  const m = a.metadata as Record<string, string | number | null | undefined>;
  const title = m.title ? `“${m.title}”` : a.entityType;
  switch (`${a.entityType}.${a.action}`) {
    case "project.created": return `created the project ${title}`;
    case "project.updated": return `updated the project`;
    case "project.status_changed": return `changed project status from ${label(m.from)} to ${label(m.to)}`;
    case "project.dates_changed": return `changed project dates (${m.from ?? "?"} → ${m.to ?? "?"})`;
    case "project.archived": return `archived the project`;
    case "project.unarchived": return `restored the project from the archive`;
    case "milestone.created": return `added milestone ${title}`;
    case "milestone.updated": return `updated milestone ${title}`;
    case "milestone.completed": return `completed milestone ${title}`;
    case "milestone.reopened": return `reopened milestone ${title}`;
    case "milestone.deleted": return `deleted milestone ${title}`;
    case "milestone.dates_changed": return `moved milestone ${title} due date (${m.from ?? "?"} → ${m.to ?? "?"})`;
    case "task.created": return `created task ${title}`;
    case "task.updated": return `updated task ${title}`;
    case "task.status_changed": return `moved task ${title} from ${label(m.from)} to ${label(m.to)}`;
    case "task.assigned": return `assigned task ${title} to ${m.assignee ?? "someone"}`;
    case "task.deleted": return `deleted task ${title}`;
    case "comment.created": return `commented on ${m.on ?? "an item"} ${title}`;
    case "update.published": return `published the update ${title}`;
    case "update.edited": return `edited the update ${title}`;
    case "update.retracted": return `retracted the update ${title}`;
    case "attachment.added": return `attached ${title}`;
    case "attachment.deleted": return `removed attachment ${title}`;
    case "risk.created": return `registered ${m.kind ?? "risk"} ${title}`;
    case "risk.updated": return `updated ${m.kind ?? "risk"} ${title}`;
    case "risk.resolved": return `resolved ${m.kind ?? "risk"} ${title}`;
    case "risk.deleted": return `deleted ${m.kind ?? "risk"} ${title}`;
    default: return `${a.action.replaceAll("_", " ")} (${a.entityType})`;
  }
}

function label(v: unknown) {
  return typeof v === "string" ? v.replaceAll("_", " ") : "?";
}
