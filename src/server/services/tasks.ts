import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { type DbOrTx, getDb, schema } from "@/db";
import { wouldCreateCycle, positionAtIndex } from "@/lib/dependencies";
import { addDaysISO, todayISO } from "@/lib/dates";
import { notFound, ruleViolation } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import { resolveTaskStatusChange } from "@/lib/transitions";
import type { TaskInput } from "@/lib/validation";
import type { Ctx } from "../types";
import { logActivity } from "./activity";
import { reconcileMilestone } from "./milestones";
import { notify } from "./notifications";
import { requireProject } from "./projects";
import { attachmentKeysWhere, collectStorageKeys, removeObjects } from "./storage-cleanup";
import { assertWorkspaceMembers } from "./workspaces";

const { tasks, taskDependencies, taskLabels, labels, milestones, projects, user, workspaces } = schema;

export type TaskRow = typeof tasks.$inferSelect;
type TaskStatus = TaskRow["status"];

export async function requireTask(db: DbOrTx, ctx: Pick<Ctx, "workspaceId">, taskId: string): Promise<TaskRow> {
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, ctx.workspaceId)));
  if (!t) throw notFound("Task");
  return t;
}

export interface TaskFilter {
  projectId?: string;
  milestoneId?: string;
  /** User id, or "me" resolved by the caller, or "unassigned". */
  assigneeId?: string | "unassigned";
  status?: TaskStatus | "open";
  priority?: TaskRow["priority"];
  due?: "overdue" | "week" | "none";
  q?: string;
  sort?: "due" | "priority" | "status" | "title" | "updated";
  dir?: "asc" | "desc";
  limit?: number;
}

const PRIORITY_RANK = sql`CASE ${tasks.priority} WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;
const STATUS_RANK = sql`CASE ${tasks.status} WHEN 'backlog' THEN 0 WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 3 ELSE 4 END`;

export async function listTasks(ctx: Ctx, f: TaskFilter = {}, today = todayISO()) {
  const db = getDb();
  const where: SQL[] = [eq(tasks.workspaceId, ctx.workspaceId)];
  if (f.projectId) where.push(eq(tasks.projectId, f.projectId));
  if (f.milestoneId) where.push(eq(tasks.milestoneId, f.milestoneId));
  if (f.assigneeId === "unassigned") where.push(isNull(tasks.assigneeId));
  else if (f.assigneeId) where.push(eq(tasks.assigneeId, f.assigneeId));
  if (f.status === "open") where.push(ne(tasks.status, "done"));
  else if (f.status) where.push(eq(tasks.status, f.status));
  if (f.priority) where.push(eq(tasks.priority, f.priority));
  if (f.due === "overdue") where.push(and(ne(tasks.status, "done"), lt(tasks.dueDate, today))!);
  if (f.due === "week") where.push(and(ne(tasks.status, "done"), isNotNull(tasks.dueDate), sql`${tasks.dueDate} >= ${today}`, lte(tasks.dueDate, addDaysISO(today, 7)))!);
  if (f.due === "none") where.push(isNull(tasks.dueDate));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(tasks.title, like), ilike(tasks.description, like))!);
  }
  const dir = f.dir === "desc" ? desc : asc;
  const order = {
    due: sql`${tasks.dueDate} ${f.dir === "desc" ? sql`DESC` : sql`ASC`} NULLS LAST`,
    priority: dir(PRIORITY_RANK),
    status: dir(STATUS_RANK),
    title: dir(tasks.title),
    updated: dir(tasks.updatedAt),
  }[f.sort ?? "due"];

  const rows = await db
    .select({
      task: tasks,
      assigneeName: user.name,
      milestoneTitle: milestones.title,
      projectTitle: projects.title,
      projectColor: projects.color,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(user, eq(user.id, tasks.assigneeId))
    .leftJoin(milestones, eq(milestones.id, tasks.milestoneId))
    .where(and(...where))
    .orderBy(order, asc(tasks.position))
    .limit(Math.min(f.limit ?? 500, 1000));

  const ids = rows.map((r) => r.task.id);
  const labelRows = ids.length
    ? await db
        .select({ taskId: taskLabels.taskId, name: labels.name, color: labels.color })
        .from(taskLabels)
        .innerJoin(labels, eq(labels.id, taskLabels.labelId))
        .where(inArray(taskLabels.taskId, ids))
    : [];
  const parentIds = new Set(rows.map((r) => r.task.parentTaskId).filter(Boolean));
  return rows.map((r) => ({
    ...r,
    labels: labelRows.filter((l) => l.taskId === r.task.id),
    hasSubtasks: parentIds.has(r.task.id),
  }));
}

export async function getTaskDetail(ctx: Ctx, taskId: string) {
  const db = getDb();
  const task = await requireTask(db, ctx, taskId);
  const [lbls, deps, subs, assignee] = await Promise.all([
    db.select({ name: labels.name, color: labels.color }).from(taskLabels).innerJoin(labels, eq(labels.id, taskLabels.labelId)).where(eq(taskLabels.taskId, taskId)),
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
      .where(and(eq(taskDependencies.taskId, taskId), eq(taskDependencies.workspaceId, ctx.workspaceId))),
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.workspaceId, ctx.workspaceId)))
      .orderBy(asc(tasks.position)),
    task.assigneeId ? db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, task.assigneeId)) : Promise.resolve([]),
  ]);
  return { task, labels: lbls, dependsOn: deps, subtasks: subs, assignee: assignee[0] ?? null };
}

async function upsertLabels(tx: DbOrTx, ctx: Pick<Ctx, "workspaceId">, taskId: string, names: string[]) {
  await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
  if (!names.length) return;
  await tx.insert(labels).values(names.map((name) => ({ workspaceId: ctx.workspaceId, name }))).onConflictDoNothing();
  const rows = await tx.select({ id: labels.id }).from(labels).where(and(eq(labels.workspaceId, ctx.workspaceId), inArray(labels.name, names)));
  await tx.insert(taskLabels).values(rows.map((l) => ({ taskId, labelId: l.id }))).onConflictDoNothing();
}

async function setDependencies(tx: DbOrTx, ctx: Pick<Ctx, "workspaceId">, task: TaskRow, dependsOn: string[]) {
  const ids = Array.from(new Set(dependsOn));
  if (ids.length) {
    const found = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(inArray(tasks.id, ids), eq(tasks.projectId, task.projectId), eq(tasks.workspaceId, ctx.workspaceId)));
    if (found.length !== ids.length) throw ruleViolation("Dependencies must be tasks in the same project.");
    const edges = await tx.select({ taskId: taskDependencies.taskId, dependsOnTaskId: taskDependencies.dependsOnTaskId }).from(taskDependencies).where(eq(taskDependencies.workspaceId, ctx.workspaceId));
    if (wouldCreateCycle(edges, task.id, ids)) throw ruleViolation("Those dependencies would create a cycle.");
  }
  await tx.delete(taskDependencies).where(eq(taskDependencies.taskId, task.id));
  if (ids.length) {
    await tx.insert(taskDependencies).values(ids.map((d) => ({ workspaceId: ctx.workspaceId, taskId: task.id, dependsOnTaskId: d })));
  }
}

async function countUnfinished(tx: DbOrTx, taskId: string) {
  const [deps] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnTaskId))
    .where(and(eq(taskDependencies.taskId, taskId), ne(tasks.status, "done")));
  const [subs] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), ne(tasks.status, "done")));
  return { unfinishedDependencies: deps?.n ?? 0, unfinishedSubtasks: subs?.n ?? 0 };
}

async function nextPosition(tx: DbOrTx, projectId: string, status: TaskStatus) {
  const [r] = await tx
    .select({ max: sql<number | null>`max(${tasks.position})` })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)));
  return (r?.max ?? 0) + 1024;
}

async function resolveRelations(tx: DbOrTx, ctx: Ctx, projectId: string, input: Pick<TaskInput, "milestoneId" | "parentTaskId" | "assigneeId">) {
  await assertWorkspaceMembers(tx, ctx.workspaceId, [input.assigneeId]);
  let milestoneId = input.milestoneId;
  if (milestoneId) {
    const [m] = await tx.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId), eq(milestones.workspaceId, ctx.workspaceId)));
    if (!m) throw ruleViolation("That milestone does not belong to this project.");
  }
  if (input.parentTaskId) {
    const parent = await requireTask(tx, ctx, input.parentTaskId);
    if (parent.projectId !== projectId) throw ruleViolation("A subtask must be in the same project as its parent.");
    if (parent.parentTaskId) throw ruleViolation("Subtasks can only be one level deep.");
    milestoneId = parent.milestoneId; // subtasks always belong to their parent's milestone
  }
  return { milestoneId, parentTaskId: input.parentTaskId };
}

async function notifyAssigned(tx: DbOrTx, ctx: Ctx, task: TaskRow) {
  if (!task.assigneeId) return;
  const [ws] = await tx.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  await notify(tx, {
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    recipientIds: [task.assigneeId],
    type: "task_assigned",
    title: `You were assigned: ${task.title}`,
    link: `/w/${ws.slug}/projects/${task.projectId}?task=${task.id}`,
  });
}

export async function createTask(ctx: Ctx, projectId: string, input: TaskInput) {
  assertCan(ctx.role, "task:create");
  return getDb().transaction(async (tx) => {
    await requireProject(tx, ctx, projectId);
    const rel = await resolveRelations(tx, ctx, projectId, input);
    const [t] = await tx
      .insert(tasks)
      .values({
        workspaceId: ctx.workspaceId,
        projectId,
        milestoneId: rel.milestoneId,
        parentTaskId: rel.parentTaskId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId,
        startDate: input.startDate,
        dueDate: input.dueDate,
        estimateHours: input.estimateHours === null ? null : String(input.estimateHours),
        actualHours: input.actualHours === null ? null : String(input.actualHours),
        progress: input.progress,
        position: await nextPosition(tx, projectId, input.status),
        completedAt: input.status === "done" ? new Date() : null,
        createdById: ctx.userId,
      })
      .returning();
    await upsertLabels(tx, ctx, t.id, input.labels);
    await setDependencies(tx, ctx, t, input.dependsOn);
    await logActivity(tx, ctx, { projectId, entityType: "task", entityId: t.id, action: "created", metadata: { title: t.title } });
    await notifyAssigned(tx, ctx, t);
    await reconcileMilestone(tx, ctx, t.milestoneId);
    return t;
  });
}

export async function updateTask(ctx: Ctx, taskId: string, input: TaskInput) {
  assertCan(ctx.role, "task:update");
  return getDb().transaction(async (tx) => {
    const prev = await requireTask(tx, ctx, taskId);
    const rel = await resolveRelations(tx, ctx, prev.projectId, input);
    if (rel.parentTaskId === prev.id) throw ruleViolation("A task cannot be its own parent.");
    if (rel.parentTaskId) {
      const [hasKids] = await tx.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.parentTaskId, prev.id));
      if (hasKids.n > 0) throw ruleViolation("A task with subtasks cannot become a subtask.");
    }
    const hasChildren = !rel.parentTaskId && (await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentTaskId, prev.id)).limit(1)).length > 0;
    // Dependencies must be applied first so the completion rule sees the new set.
    await setDependencies(tx, ctx, prev, input.dependsOn);
    const { completedAt } = resolveTaskStatusChange({
      from: prev.status,
      to: input.status,
      ...(await countUnfinished(tx, taskId)),
      now: new Date(),
      completedAt: prev.completedAt,
    });
    // Children follow a parent's milestone.
    const milestoneId = rel.milestoneId;
    const [t] = await tx
      .update(tasks)
      .set({
        milestoneId,
        parentTaskId: rel.parentTaskId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId,
        startDate: input.startDate,
        dueDate: input.dueDate,
        estimateHours: input.estimateHours === null ? null : String(input.estimateHours),
        actualHours: input.actualHours === null ? null : String(input.actualHours),
        progress: input.progress,
        completedAt,
        ...(prev.status !== input.status ? { position: await nextPosition(tx, prev.projectId, input.status) } : {}),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, ctx.workspaceId)))
      .returning();
    if (hasChildren && prev.milestoneId !== milestoneId) {
      await tx.update(tasks).set({ milestoneId }).where(eq(tasks.parentTaskId, taskId));
    }
    await upsertLabels(tx, ctx, taskId, input.labels);
    await afterTaskChange(tx, ctx, prev, t);
    return t;
  });
}

async function afterTaskChange(tx: DbOrTx, ctx: Ctx, prev: TaskRow, t: TaskRow) {
  const base = { projectId: t.projectId, entityType: "task", entityId: t.id } as const;
  if (prev.status === t.status) {
    await logActivity(tx, ctx, { ...base, action: "updated", metadata: { title: t.title } });
  } else {
    await logActivity(tx, ctx, { ...base, action: "status_changed", metadata: { title: t.title, from: prev.status, to: t.status } });
  }
  if (prev.assigneeId !== t.assigneeId) {
    if (t.assigneeId) {
      const [a] = await tx.select({ name: user.name }).from(user).where(eq(user.id, t.assigneeId));
      await logActivity(tx, ctx, { ...base, action: "assigned", metadata: { title: t.title, assignee: a?.name } });
    }
    await notifyAssigned(tx, ctx, t);
  }
  await reconcileMilestone(tx, ctx, t.milestoneId);
  if (prev.milestoneId !== t.milestoneId) await reconcileMilestone(tx, ctx, prev.milestoneId);
}

export async function quickCreateTask(ctx: Ctx, projectId: string, input: { title: string; milestoneId: string | null; status: TaskStatus }) {
  return createTask(ctx, projectId, {
    title: input.title,
    description: "",
    status: input.status,
    priority: "medium",
    assigneeId: null,
    milestoneId: input.milestoneId,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
    estimateHours: null,
    actualHours: null,
    progress: null,
    labels: [],
    dependsOn: [],
  });
}

/**
 * Kanban drop: moves a task to `status` at `index` within that column. The new fractional position
 * is computed on the server from the persisted column order, and the status change goes through the
 * same transition rules as any other edit.
 */
export async function moveTask(ctx: Ctx, taskId: string, status: TaskStatus, index: number) {
  assertCan(ctx.role, "task:update");
  return getDb().transaction(async (tx) => {
    const prev = await requireTask(tx, ctx, taskId);
    const { completedAt } = resolveTaskStatusChange({
      from: prev.status,
      to: status,
      ...(prev.status === status ? { unfinishedDependencies: 0, unfinishedSubtasks: 0 } : await countUnfinished(tx, taskId)),
      now: new Date(),
      completedAt: prev.completedAt,
    });
    const column = await tx
      .select({ position: tasks.position })
      .from(tasks)
      .where(and(eq(tasks.projectId, prev.projectId), eq(tasks.status, status), ne(tasks.id, taskId)));
    const position = positionAtIndex(column.map((c) => c.position), index);
    const [t] = await tx.update(tasks).set({ status, position, completedAt }).where(eq(tasks.id, taskId)).returning();
    if (prev.status !== status) await afterTaskChange(tx, ctx, prev, t);
    return t;
  });
}

export async function deleteTask(ctx: Ctx, taskId: string) {
  assertCan(ctx.role, "task:delete");
  const keys = await collectStorageKeys(attachmentKeysWhere.task(ctx.workspaceId, taskId));
  await getDb().transaction(async (tx) => {
    const t = await requireTask(tx, ctx, taskId);
    await tx.delete(tasks).where(eq(tasks.id, taskId));
    await logActivity(tx, ctx, { projectId: t.projectId, entityType: "task", entityId: t.id, action: "deleted", metadata: { title: t.title } });
    await reconcileMilestone(tx, ctx, t.milestoneId);
  });
  await removeObjects(keys);
}
