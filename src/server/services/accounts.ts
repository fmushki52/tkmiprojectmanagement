import { getDb, schema } from "@/db";
import { getAuth } from "@/lib/auth/auth";
import { conflict } from "@/lib/errors";
import { type WorkspaceRole, assertCan } from "@/lib/permissions";
import type { Ctx } from "../types";

export interface NewAccount {
  name: string;
  email: string;
  password: string;
  role: WorkspaceRole;
}

/**
 * Creates a sign-in account for someone who does not have one yet and adds them to the workspace.
 *
 * This goes through Better Auth's internal adapter instead of `signUpEmail` so the administrator's own
 * session is untouched. It only ever creates NEW accounts; it never changes an existing user's
 * password, so a workspace owner cannot take over an account that belongs to other workspaces.
 */
export async function createMemberAccount(ctx: Ctx, input: NewAccount) {
  assertCan(ctx.role, "member:manage");
  const auth = await getAuth().$context;
  const email = input.email.trim().toLowerCase();
  if (await auth.internalAdapter.findUserByEmail(email)) {
    throw conflict("An account with that email already exists. Use “Add existing user” instead.");
  }
  const hash = await auth.password.hash(input.password);
  const created = await auth.internalAdapter.createUser({ email, name: input.name.trim(), emailVerified: false }, { method: "admin" });
  try {
    await auth.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: hash });
    await getDb().insert(schema.workspaceMembers).values({ workspaceId: ctx.workspaceId, userId: created.id, role: input.role });
  } catch (e) {
    await auth.internalAdapter.deleteUser(created.id).catch(() => undefined); // do not leave a half-created account
    throw e;
  }
  return { userId: created.id };
}
