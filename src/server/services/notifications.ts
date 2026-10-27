import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { type DbOrTx, getDb, schema } from "@/db";
import { addDaysISO, formatDate, todayISO } from "@/lib/dates";
import type { Ctx } from "../types";

const { notifications, workspaceMembers, tasks, projects, workspaces } = schema;

type NotificationType = (typeof schema.notificationType.enumValues)[number];

export interface NotifyInput {
  workspaceId: string;
  /** Who caused the event; never notified about their own action. */
  actorId: string | null;
  recipientIds: (string | null | undefined)[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
}

/**
 * The single entry point for creating notifications. Today it writes persistent in-app
 * notifications; email delivery can later be added here (or via a queue fed from the inserted rows)
 * without touching the callers. Recipients that are not members of the workspace are dropped.
 */
export async function notify(tx: DbOrTx, input: NotifyInput): Promise<number> {
  const wanted = Array.from(new Set(input.recipientIds.filter((id): id is string => !!id && id !== input.actorId)));
  if (!wanted.length) return 0;
  const members = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), inArray(workspaceMembers.userId, wanted)));
  if (!members.length) return 0;
  const inserted = await tx
    .insert(notifications)
    .values(
      members.map((m) => ({
        workspaceId: input.workspaceId,
        userId: m.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? "",
        link: input.link ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return inserted.length;
}

export async function listNotifications(ctx: Ctx, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const filters = [eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId)];
  if (opts.unreadOnly) filters.push(isNull(notifications.readAt));
  return getDb()
    .select()
    .from(notifications)
    .where(and(...filters))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 50);
}

export async function unreadCount(ctx: Ctx): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markRead(ctx: Ctx, id: string) {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
}

export async function markAllRead(ctx: Ctx) {
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId), isNull(notifications.readAt)));
}

export const DEADLINE_WINDOW_DAYS = 3;

/**
 * Generates deadline notifications for open tasks: "due soon" (within DEADLINE_WINDOW_DAYS) and
 * "overdue" to the assignee. Idempotent per task per state per day via dedupe keys. Called lazily
 * when a user opens the app and by the scheduled /api/cron/deadlines route for all workspaces.
 */
export async function syncDeadlineNotifications(workspaceId: string, today = todayISO()): Promise<number> {
  const db = getDb();
  const soonCutoff = addDaysISO(today, DEADLINE_WINDOW_DAYS);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      assigneeId: tasks.assigneeId,
      projectId: tasks.projectId,
      slug: workspaces.slug,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        ne(tasks.status, "done"),
        isNull(projects.archivedAt),
        notInArray(projects.status, ["completed", "cancelled"]),
        sql`${tasks.assigneeId} IS NOT NULL`,
        sql`${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} <= ${soonCutoff}`,
      ),
    );
  let created = 0;
  for (const t of rows) {
    const overdue = t.dueDate! < today;
    created += await notify(db, {
      workspaceId,
      actorId: null,
      recipientIds: [t.assigneeId],
      type: overdue ? "task_overdue" : "deadline_upcoming",
      title: overdue ? `Overdue: ${t.title}` : `Due soon: ${t.title}`,
      body: `${overdue ? "Was due" : "Due"} ${formatDate(t.dueDate)}`,
      link: `/w/${t.slug}/projects/${t.projectId}?task=${t.id}`,
      dedupeKey: `${overdue ? "overdue" : "soon"}:${t.id}:${overdue ? today : t.dueDate}`,
    });
  }
  return created;
}

/** For the cron route: every workspace. */
export async function syncAllDeadlineNotifications(today = todayISO()): Promise<number> {
  const all = await getDb().select({ id: workspaces.id }).from(workspaces);
  let n = 0;
  for (const w of all) n += await syncDeadlineNotifications(w.id, today);
  return n;
}

