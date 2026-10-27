import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Ctx } from "@/server/types";
import type { MilestoneInput, ProjectInput, RiskInput, TaskInput } from "@/lib/validation";
import type { WorkspaceRole } from "@/lib/permissions";

/**
 * In-process Postgres (PGlite) with the real SQL migrations applied, so integration tests exercise
 * the actual schema, constraints, enums and transactions. Services reach the database through
 * `getDb()`, which each test file points at this instance via `vi.mock("@/db")` (see test files).
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let seq = 0;
export async function seedUser(db: TestDb, name: string) {
  const id = `user_${++seq}_${name.toLowerCase().replace(/\W+/g, "")}`;
  await db.insert(schema.user).values({ id, name, email: `${id}@example.com` });
  return { id, name, email: `${id}@example.com` };
}

/** Creates a workspace and returns one Ctx per requested role (each with its own user). */
export async function seedWorkspace(db: TestDb, name: string, roles: WorkspaceRole[] = ["owner"]) {
  const [ws] = await db.insert(schema.workspaces).values({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${++seq}` }).returning();
  const ctxs = {} as Record<WorkspaceRole, Ctx & { name: string }>;
  for (const role of roles) {
    const u = await seedUser(db, `${name} ${role}`);
    await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: u.id, role });
    ctxs[role] = { userId: u.id, workspaceId: ws.id, role, name: u.name };
  }
  return { workspace: ws, ...ctxs };
}

export function projectInput(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    title: "Website relaunch",
    description: "Rebuild the marketing site",
    scope: "",
    startDate: "2026-01-01",
    plannedEndDate: "2026-06-30",
    actualStartDate: null,
    actualEndDate: null,
    ownerId: null,
    status: "in_progress",
    priority: "high",
    health: null,
    color: "#6366f1",
    tags: ["web"],
    progressWeighting: "equal",
    memberIds: [],
    ...over,
  };
}

export function milestoneInput(over: Partial<MilestoneInput> = {}): MilestoneInput {
  return {
    title: "Design complete",
    description: "",
    dueDate: "2026-03-01",
    actualDate: null,
    ownerId: null,
    status: "not_started",
    priority: "medium",
    progressMode: "calculated",
    manualProgress: null,
    ...over,
  };
}

export function taskInput(over: Partial<TaskInput> = {}): TaskInput {
  return {
    title: "Write homepage copy",
    description: "",
    status: "todo",
    priority: "medium",
    assigneeId: null,
    milestoneId: null,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
    estimateHours: null,
    actualHours: null,
    progress: null,
    labels: [],
    dependsOn: [],
    ...over,
  };
}

export function riskInput(over: Partial<RiskInput> = {}): RiskInput {
  return {
    kind: "risk",
    title: "Vendor delay",
    description: "",
    severity: "high",
    likelihood: "medium",
    ownerId: null,
    mitigation: "",
    status: "open",
    targetDate: null,
    ...over,
  };
}

/** Call in beforeAll of an integration test file. */
export async function useTestDb(): Promise<TestDb> {
  const db = await createTestDb();
  (globalThis as { __TEST_DB__?: unknown }).__TEST_DB__ = db;
  return db;
}
