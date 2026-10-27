import { todayISO, addDaysISO } from "@/lib/dates";
import { leafTasks } from "@/lib/progress";
import { buildBurnup } from "@/lib/progress/burnup";
import type { Ctx } from "../types";
import { listProjectActivity } from "./activity";
import { listMilestones } from "./milestones";
import { toProgressTask, computeMetrics } from "./metrics";
import { getProjectDetail, listProjects, loadProjectData } from "./projects";
import { listRisks } from "./risks";
import { listTasks } from "./tasks";
import { listUpdates } from "./updates";
import { getDb, schema } from "@/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { listMembers } from "./workspaces";

/** Everything the project page renders, loaded through the individual (authorized) services. */
export async function getProjectOverview(ctx: Ctx, projectId: string, today = todayISO()) {
  const { project, members, owner } = await getProjectDetail(ctx, projectId);
  const [edges, data, milestoneRows, taskRows, riskRows, updates, activity, workspaceMembers] = await Promise.all([
    getDb()
      .select({ taskId: schema.taskDependencies.taskId, dependsOnTaskId: schema.taskDependencies.dependsOnTaskId })
      .from(schema.taskDependencies)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
      .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.workspaceId, ctx.workspaceId))),
    loadProjectData(getDb(), ctx.workspaceId, projectId),
    listMilestones(ctx, projectId),
    listTasks(ctx, { projectId, sort: "due" }, today),
    listRisks(ctx, projectId),
    listUpdates(ctx, projectId),
    listProjectActivity(ctx, projectId, 25),
    listMembers(ctx),
  ]);
  const metrics = computeMetrics(project, data.milestones, data.tasks, data.risks, today);
  const leafIds = new Set(leafTasks(data.tasks.map(toProgressTask)).map((t) => t.id));

  const open = taskRows.filter((r) => leafIds.has(r.task.id) && r.task.status !== "done");
  const horizon = addDaysISO(today, 14);
  const deadlines = [
    ...open
      .filter((r) => r.task.dueDate && r.task.dueDate <= horizon)
      .map((r) => ({ kind: "task" as const, id: r.task.id, title: r.task.title, date: r.task.dueDate!, overdue: r.task.dueDate! < today, who: r.assigneeName })),
    ...data.milestones
      .filter((m) => m.status !== "completed" && m.dueDate <= horizon)
      .map((m) => ({ kind: "milestone" as const, id: m.id, title: m.title, date: m.dueDate, overdue: m.dueDate < today, who: null as string | null })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const burnup = buildBurnup(
    data.tasks.filter((t) => leafIds.has(t.id)).map((t) => ({ dueDate: t.dueDate, completedAt: t.completedAt })),
    project.startDate,
    project.plannedEndDate,
    today,
  );

  return {
    today,
    project,
    owner,
    members,
    workspaceMembers,
    metrics,
    milestones: milestoneRows,
    tasks: taskRows,
    leafTaskIds: leafIds,
    dependencies: edges,
    risks: riskRows,
    updates,
    activity,
    deadlines,
    burnup,
  };
}
export type ProjectOverview = Awaited<ReturnType<typeof getProjectOverview>>;


/** Active projects plus all of their milestones, for the workspace-wide timeline. */
export async function getWorkspaceTimeline(ctx: Ctx, today = todayISO()) {
  const { items } = await listProjects(ctx, { pageSize: 100, sort: "start", dir: "asc" }, today);
  const ids = items.map((i) => i.project.id);
  const ms = ids.length
    ? await getDb()
        .select()
        .from(schema.milestones)
        .where(and(eq(schema.milestones.workspaceId, ctx.workspaceId), inArray(schema.milestones.projectId, ids)))
        .orderBy(asc(schema.milestones.dueDate))
    : [];
  return { today, projects: items, milestones: ms };
}
