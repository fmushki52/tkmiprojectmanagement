import "server-only";
import { headers } from "next/headers";
import { notFound as nextNotFound, redirect } from "next/navigation";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { getAuth } from "@/lib/auth/auth";
import { notFound, unauthenticated } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { resolveMembership } from "./services/workspaces";
import type { Ctx } from "./types";

export const getSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

/** For pages/layouts: redirects to sign-in when there is no session. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function requireUserOrThrow() {
  const session = await getSession();
  if (!session) throw unauthenticated();
  return session.user;
}

/** Page context: the signed-in user's membership in the workspace named by the URL slug. */
export const getWorkspaceCtx = cache(async (slug: string) => {
  const user = await requireUser();
  const m = await resolveMembership(user.id, { slug });
  // Same 404 whether the workspace doesn't exist or the user isn't a member.
  if (!m) nextNotFound();
  return { user, ...m };
});

/** Action context from a workspace id supplied by the client: membership is verified server-side. */
export async function getCtxByWorkspaceId(workspaceId: string): Promise<Ctx> {
  const user = await requireUserOrThrow();
  const m = await resolveMembership(user.id, { id: workspaceId });
  if (!m) throw notFound("Workspace");
  return { userId: m.userId, workspaceId: m.workspaceId, role: m.role };
}

/**
 * Action context derived from a project id: the workspace is read from the project itself, then the
 * caller's membership in THAT workspace is verified. Changing an id in a request can never grant
 * access to another workspace's data.
 */
export async function getCtxByProjectId(projectId: string): Promise<Ctx> {
  const user = await requireUserOrThrow();
  const [p] = await getDb()
    .select({ workspaceId: schema.projects.workspaceId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!p) throw notFound("Project");
  const m = await resolveMembership(user.id, { id: p.workspaceId });
  if (!m) throw notFound("Project");
  return { userId: m.userId, workspaceId: m.workspaceId, role: m.role };
}

type EntityTable = "milestones" | "tasks" | "risks" | "comments" | "projectUpdates" | "attachments";

/** Action context for a row that belongs to a workspace (milestone, task, risk, comment, update). */
export async function getCtxByEntity(table: EntityTable, id: string): Promise<Ctx> {
  const user = await requireUserOrThrow();
  const t = schema[table];
  const [row] = await getDb().select({ workspaceId: t.workspaceId }).from(t).where(eq(t.id, id));
  if (!row) throw notFound("Item");
  const m = await resolveMembership(user.id, { id: row.workspaceId });
  if (!m) throw notFound("Item");
  return { userId: m.userId, workspaceId: m.workspaceId, role: m.role };
}
