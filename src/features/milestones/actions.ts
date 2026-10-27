"use server";

import { z } from "zod";
import { milestoneSchema, uuid } from "@/lib/validation";
import { getCtxByEntity, getCtxByProjectId } from "@/server/context";
import { parse, runAction } from "@/server/action";
import * as milestones from "@/server/services/milestones";

export async function createMilestoneAction(projectId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    await milestones.createMilestone(await getCtxByProjectId(id), id, parse(milestoneSchema, input));
  });
}

export async function updateMilestoneAction(milestoneId: string, input: unknown) {
  return runAction(async () => {
    const id = parse(uuid, milestoneId);
    await milestones.updateMilestone(await getCtxByEntity("milestones", id), id, parse(milestoneSchema, input));
  });
}

export async function deleteMilestoneAction(milestoneId: string) {
  return runAction(async () => {
    const id = parse(uuid, milestoneId);
    await milestones.deleteMilestone(await getCtxByEntity("milestones", id), id);
  });
}

export async function reorderMilestonesAction(projectId: string, orderedIds: string[]) {
  return runAction(async () => {
    const id = parse(uuid, projectId);
    await milestones.reorderMilestones(await getCtxByProjectId(id), id, parse(z.array(uuid), orderedIds));
  });
}
