"use server";

import { projectSchema, uuid } from "@/lib/validation";
import { getCtxByProjectId, getCtxByWorkspaceId } from "@/server/context";
import { parse, runAction } from "@/server/action";
import * as projects from "@/server/services/projects";

export async function createProjectAction(workspaceId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await getCtxByWorkspaceId(parse(uuid, workspaceId));
    const p = await projects.createProject(ctx, parse(projectSchema, input));
    return { id: p.id };
  });
}

export async function updateProjectAction(projectId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    await projects.updateProject(await getCtxByProjectId(id), id, parse(projectSchema, input));
  });
}

export async function archiveProjectAction(projectId: string, archived: boolean) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    await projects.setProjectArchived(await getCtxByProjectId(id), id, archived);
  });
}

export async function deleteProjectAction(projectId: string) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    await projects.deleteProject(await getCtxByProjectId(id), id);
  });
}
