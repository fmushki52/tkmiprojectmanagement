import type { WorkspaceRole } from "@/lib/permissions";

/**
 * Authorization context for one request. It is only ever produced by `server/context.ts`
 * after verifying the signed-in user's membership in `workspaceId`; services trust it and scope
 * every query by `workspaceId`.
 */
export interface Ctx {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}
