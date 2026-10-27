"use server";

import { z } from "zod";
import { TASK_STATUSES, quickTaskSchema, taskSchema, uuid } from "@/lib/validation";
import { getCtxByEntity, getCtxByProjectId } from "@/server/context";
import { parse, runAction } from "@/server/action";
import * as tasks from "@/server/services/tasks";

export async function createTaskAction(projectId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    const t = await tasks.createTask(await getCtxByProjectId(id), id, parse(taskSchema, input));
    return { id: t.id };
  });
}

export async function quickCreateTaskAction(projectId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    const v = parse(quickTaskSchema, input);
    const t = await tasks.quickCreateTask(await getCtxByProjectId(id), id, v);
    return { id: t.id };
  });
}

export async function updateTaskAction(taskId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, taskId);
    await tasks.updateTask(await getCtxByEntity("tasks", id), id, parse(taskSchema, input));
  });
}

/** Kanban drop. The server recomputes order from persisted data; the client only sends intent. */
export async function moveTaskAction(taskId: string, status: string, index: number) {
  return runAction(async () => {
    const id = parse(uuid, taskId);
    await tasks.moveTask(
      await getCtxByEntity("tasks", id),
      id,
      parse(z.enum(TASK_STATUSES), status),
      parse(z.number().int().min(0).max(10000), index),
    );
  });
}

export async function deleteTaskAction(taskId: string) {
  return runAction(async () => {
    const id = parse(uuid, taskId);
    await tasks.deleteTask(await getCtxByEntity("tasks", id), id);
  });
}

/** Read used by the task detail panel (details, subtasks, dependencies). Authorized like any other call. */
export async function loadTaskDetailAction(taskId: string) {
  return runAction(async () => {
    const id = parse(uuid, taskId);
    const detail = await tasks.getTaskDetail(await getCtxByEntity("tasks", id), id);
    return {
      labels: detail.labels.map((l) => l.name),
      dependsOn: detail.dependsOn,
      subtasks: detail.subtasks,
    };
  });
}
