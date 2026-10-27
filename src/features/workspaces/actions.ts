"use server";

import { z } from "zod";
import { addMemberSchema, createUserSchema, uuid, workspaceSchema } from "@/lib/validation";
import { WORKSPACE_ROLES } from "@/lib/permissions";
import { getCtxByWorkspaceId, requireUserOrThrow } from "@/server/context";
import { parse, runAction } from "@/server/action";
import { createMemberAccount } from "@/server/services/accounts";
import * as workspaces from "@/server/services/workspaces";

export async function createWorkspaceAction(input: unknown) {
  return runAction(async () => {
    const user = await requireUserOrThrow();
    const values = parse(workspaceSchema, input);
    const ws = await workspaces.createWorkspace(user.id, values.name);
    return { slug: ws.slug };
  });
}

export async function renameWorkspaceAction(workspaceId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await getCtxByWorkspaceId(parse(uuid, workspaceId));
    await workspaces.updateWorkspaceName(ctx, parse(workspaceSchema, input).name);
  });
}

export async function deleteWorkspaceAction(workspaceId: string) {
  return runAction(async () => {
    await workspaces.deleteWorkspace(await getCtxByWorkspaceId(parse(uuid, workspaceId)));
  });
}

export async function addMemberAction(workspaceId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await getCtxByWorkspaceId(parse(uuid, workspaceId));
    const v = parse(addMemberSchema, input);
    await workspaces.addMemberByEmail(ctx, v.email, v.role);
  });
}

export async function changeMemberRoleAction(workspaceId: string, memberId: string, role: string) {
  return runAction(async () => {
    const ctx = await getCtxByWorkspaceId(parse(uuid, workspaceId));
    await workspaces.changeMemberRole(ctx, parse(uuid, memberId), parse(z.enum(WORKSPACE_ROLES), role));
  });
}

export async function removeMemberAction(workspaceId: string, memberId: string) {
  return runAction(async () => {
    const ctx = await getCtxByWorkspaceId(parse(uuid, workspaceId));
    await workspaces.removeMember(ctx, parse(uuid, memberId));
  });
}

/** Creates a brand-new sign-in account and adds it to the workspace (owners only). */
export async function createUserAction(workspaceId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await getCtxByWorkspaceId(parse(uuid, workspaceId));
    await createMemberAccount(ctx, parse(createUserSchema, input));
  });
}
