/**
 * Creates the first sign-in account and its workspace (the account becomes the workspace OWNER).
 * Run it yourself against the database you want to bootstrap; credentials come from the environment,
 * so nothing secret lives in the repository:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long password' DATABASE_URL=<neon url> npm run db:create-admin
 *
 * Optional: ADMIN_NAME (defaults to the part before @), ADMIN_WORKSPACE (defaults to "My Workspace").
 *
 * Safe to re-run: if the email already has an account the script changes nothing (it never resets a
 * password) and only reports what exists.
 */
import { config } from "dotenv";
import { Pool as NeonPool } from "@neondatabase/serverless";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool as PgPool } from "pg";
import { slugify } from "../src/lib/slug";
import * as schema from "../src/db/schema";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("ADMIN_EMAIL is missing or not a valid email");
  if (!password || password.length < 8) throw new Error("ADMIN_PASSWORD is missing or shorter than 8 characters");
  const name = process.env.ADMIN_NAME?.trim() || email.split("@")[0];
  const workspaceName = process.env.ADMIN_WORKSPACE?.trim() || "My Workspace";

  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  const pool = local ? new PgPool({ connectionString: url, max: 1 }) : new NeonPool({ connectionString: url, max: 1 });
  const db = (local ? drizzlePg(pool as PgPool, { schema }) : drizzleNeon(pool as NeonPool, { schema })) as unknown as PgDatabase<PgQueryResultHKT, typeof schema>;

  try {
    const auth = betterAuth({
      database: drizzleAdapter(db, { provider: "pg", schema }),
      secret: process.env.BETTER_AUTH_SECRET ?? "create-admin-script-does-not-use-this",
      emailAndPassword: { enabled: true },
    });
    const ctx = await auth.$context;

    const existing = await ctx.internalAdapter.findUserByEmail(email);
    if (existing) {
      const memberships = await db
        .select({ workspace: schema.workspaces.name, role: schema.workspaceMembers.role })
        .from(schema.workspaceMembers)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
        .where(eq(schema.workspaceMembers.userId, existing.user.id));
      console.log(`An account for ${email} already exists; nothing was changed (passwords are never reset by this script).`);
      console.log(memberships.length ? `Workspaces: ${memberships.map((m) => `${m.workspace} (${m.role})`).join(", ")}` : "It is not a member of any workspace yet.");
      return;
    }

    const hash = await ctx.password.hash(password);
    const created = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: "admin" });
    await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: hash });

    // Unique workspace slug, then make the account its owner.
    const base = slugify(workspaceName);
    let slug = base;
    for (let i = 2; (await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.slug, slug))).length; i++) {
      slug = `${base}-${i}`;
    }
    const [ws] = await db.insert(schema.workspaces).values({ name: workspaceName, slug, createdById: created.id }).returning();
    await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: created.id, role: "owner" });

    console.log(`Created ${email} as OWNER of workspace "${ws.name}" (/w/${ws.slug}). Sign in at /sign-in, then change the password.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
