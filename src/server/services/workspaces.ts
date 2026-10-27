import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { type DbOrTx, getDb, schema } from "@/db";
import { slugify } from "@/lib/slug";
import { AppError, conflict, notFound, ruleViolation } from "@/lib/errors";
import { type WorkspaceRole, assertCan } from "@/lib/permissions";
import type { Ctx } from "../types";
import { attachmentKeysWhere, collectStorageKeys, removeObjects } from "./storage-cleanup";

const { workspaces, workspaceMembers, user, projects, tasks } = schema;

export async function createWorkspace(userId: string, name: string) {
  const db = getDb();
  const base = slugify(name);
  return db.transaction(async (tx) => {
    let slug = base;
    for (let i = 2; ; i++) {
      const [taken] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug));
      if (!taken) break;
      slug = `${base}-${i}`;
    }
    const [ws] = await tx.insert(workspaces).values({ name: name.trim(), slug, createdById: userId }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" });
    return ws;
  });
}

export async function listUserWorkspaces(userId: string) {
  return getDb()
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.name));
}

/**
 * Resolves the caller's membership of a workspace by slug or id. Returns null if the workspace
 * doesn't exist OR the user isn't a member, so the two cases are indistinguishable to callers.
 */
export async function resolveMembership(
  userId: string,
  by: { slug: string } | { id: string },
): Promise<(Ctx & { workspaceName: string; workspaceSlug: string }) | null> {
  const where = "slug" in by ? eq(workspaces.slug, by.slug) : eq(workspaces.id, by.id);
  const [row] = await getDb()
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(where);
  return row ? { userId, workspaceId: row.id, role: row.role, workspaceName: row.name, workspaceSlug: row.slug } : null;
}

export async function listMembers(ctx: Ctx, db: DbOrTx = getDb()) {
  return db
    .select({
      id: workspaceMembers.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(user.name));
}

/** Members with the workload figures shown on the User Management screen. */
export async function listMembersDetailed(ctx: Ctx) {
  assertCan(ctx.role, "member:manage");
  const db = getDb();
  const members = await listMembers(ctx, db);
  const [owned, tasksOpen] = await Promise.all([
    db
      .select({ userId: projects.ownerId, n: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.workspaceId, ctx.workspaceId), isNull(projects.archivedAt)))
      .groupBy(projects.ownerId),
    db
      .select({ userId: tasks.assigneeId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, ctx.workspaceId), ne(tasks.status, "done")))
      .groupBy(tasks.assigneeId),
  ]);
  return members.map((m) => ({
    ...m,
    ownedProjects: owned.find((o) => o.userId === m.userId)?.n ?? 0,
    openTasks: tasksOpen.find((t) => t.userId === m.userId)?.n ?? 0,
  }));
}

export async function updateWorkspaceName(ctx: Ctx, name: string) {
  assertCan(ctx.role, "workspace:update");
  await getDb().update(workspaces).set({ name: name.trim() }).where(eq(workspaces.id, ctx.workspaceId));
}

export async function deleteWorkspace(ctx: Ctx) {
  assertCan(ctx.role, "workspace:delete");
  const keys = await collectStorageKeys(attachmentKeysWhere.workspace(ctx.workspaceId));
  await getDb().delete(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  await removeObjects(keys);
}

/** Adds an already-registered user. (Email invitations for unregistered users are not implemented.) */
export async function addMemberByEmail(ctx: Ctx, email: string, role: WorkspaceRole) {
  assertCan(ctx.role, "member:manage");
  const db = getDb();
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
  if (!u) {
    throw new AppError("NOT_FOUND", "No account with that email. Ask them to sign up first, then add them.", {
      email: ["No account with that email"],
    });
  }
  const [existing] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, u.id)));
  if (existing) throw conflict("That person is already a member of this workspace.");
  await db.insert(workspaceMembers).values({ workspaceId: ctx.workspaceId, userId: u.id, role });
}

async function ownerCount(tx: Pick<ReturnType<typeof getDb>, "select">, workspaceId: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner")));
  return r?.n ?? 0;
}

export async function changeMemberRole(ctx: Ctx, memberId: string, role: WorkspaceRole) {
  assertCan(ctx.role, "member:manage");
  await getDb().transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, ctx.workspaceId)));
    if (!m) throw notFound("Member");
    if (m.role === "owner" && role !== "owner" && (await ownerCount(tx, ctx.workspaceId)) <= 1) {
      throw ruleViolation("A workspace must keep at least one owner.");
    }
    await tx.update(workspaceMembers).set({ role }).where(eq(workspaceMembers.id, memberId));
  });
}

export async function removeMember(ctx: Ctx, memberId: string) {
  assertCan(ctx.role, "member:manage");
  await getDb().transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, ctx.workspaceId)));
    if (!m) throw notFound("Member");
    if (m.userId === ctx.userId) throw ruleViolation("You cannot remove yourself. Ask another owner to do it.");
    if (m.role === "owner" && (await ownerCount(tx, ctx.workspaceId)) <= 1) {
      throw ruleViolation("A workspace must keep at least one owner.");
    }
    await tx.delete(workspaceMembers).where(eq(workspaceMembers.id, memberId));
    // Their assignments/ownerships are released so nothing points at a non-member.
    await tx.execute(sql`UPDATE tasks SET assignee_id = NULL WHERE workspace_id = ${ctx.workspaceId} AND assignee_id = ${m.userId}`);
    await tx.execute(sql`UPDATE milestones SET owner_id = NULL WHERE workspace_id = ${ctx.workspaceId} AND owner_id = ${m.userId}`);
    await tx.execute(sql`UPDATE projects SET owner_id = NULL WHERE workspace_id = ${ctx.workspaceId} AND owner_id = ${m.userId}`);
    await tx.execute(sql`UPDATE risks SET owner_id = NULL WHERE workspace_id = ${ctx.workspaceId} AND owner_id = ${m.userId}`);
    await tx.execute(sql`DELETE FROM project_members WHERE workspace_id = ${ctx.workspaceId} AND user_id = ${m.userId}`);
  });
}

/** Throws unless every id is a member of the workspace. Used before assigning owners/assignees. */
export async function assertWorkspaceMembers(
  db: Pick<ReturnType<typeof getDb>, "select">,
  workspaceId: string,
  userIds: (string | null | undefined)[],
) {
  const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)));
  if (!ids.length) return;
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), sql`${workspaceMembers.userId} IN ${ids}`));
  if (rows.length !== ids.length) throw ruleViolation("Selected people must be members of this workspace.");
}
