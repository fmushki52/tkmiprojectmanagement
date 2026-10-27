import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";
import { addMemberByEmail, changeMemberRole, listMembers, listMembersDetailed, removeMember } from "@/server/services/workspaces";
import { projectInput, seedUser, seedWorkspace, taskInput, useTestDb, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => {
  db = await useTestDb();
});
const rejects = (p: Promise<unknown>) => p.then(() => null, (e) => e as AppError);

describe("user management service", () => {
  it("is restricted to owners", async () => {
    const w = await seedWorkspace(db, "Users", ["owner", "project_manager", "contributor", "viewer"]);
    expect(await listMembersDetailed(w.owner)).toHaveLength(4);
    for (const role of ["project_manager", "contributor", "viewer"] as const) {
      expect(await rejects(listMembersDetailed(w[role]))).toMatchObject({ code: "FORBIDDEN" });
    }
    const members = await listMembers(w.owner);
    const target = members.find((m) => m.userId === w.viewer.userId)!;
    expect(await rejects(changeMemberRole(w.project_manager, target.id, "owner"))).toMatchObject({ code: "FORBIDDEN" }); // no privilege escalation
    expect(await rejects(addMemberByEmail(w.project_manager, "x@example.com", "viewer"))).toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports workload per member (projects owned, open tasks), scoped to the workspace", async () => {
    const w = await seedWorkspace(db, "Load", ["owner", "contributor"]);
    const other = await seedWorkspace(db, "OtherLoad", ["owner"]);
    const p = await createProject(w.owner, projectInput({ ownerId: w.owner.userId }));
    await createTask(w.owner, p.id, taskInput({ assigneeId: w.contributor.userId }));
    await createTask(w.owner, p.id, taskInput({ title: "done one", assigneeId: w.contributor.userId, status: "done" }));
    const op = await createProject(other.owner, projectInput());
    await createTask(other.owner, op.id, taskInput());
    const rows = await listMembersDetailed(w.owner);
    expect(rows.find((r) => r.userId === w.owner.userId)).toMatchObject({ ownedProjects: 1, openTasks: 0 });
    expect(rows.find((r) => r.userId === w.contributor.userId)).toMatchObject({ ownedProjects: 0, openTasks: 1 });
    expect(rows.map((r) => r.userId)).not.toContain(other.owner.userId);
  });

  it("prevents removing yourself and keeps role changes consistent", async () => {
    const w = await seedWorkspace(db, "Self", ["owner", "contributor"]);
    const members = await listMembers(w.owner);
    const me = members.find((m) => m.userId === w.owner.userId)!;
    const them = members.find((m) => m.userId === w.contributor.userId)!;
    expect(await rejects(removeMember(w.owner, me.id))).toMatchObject({ code: "RULE", message: expect.stringMatching(/yourself/) });
    await changeMemberRole(w.owner, them.id, "project_manager");
    expect((await listMembers(w.owner)).find((m) => m.id === them.id)?.role).toBe("project_manager");
    await removeMember(w.owner, them.id);
    expect((await listMembers(w.owner)).map((m) => m.userId)).not.toContain(w.contributor.userId);
  });

  it("only adds existing accounts by email and rejects duplicates", async () => {
    const w = await seedWorkspace(db, "Add", ["owner"]);
    const u = await seedUser(db, "Newcomer");
    expect(await rejects(addMemberByEmail(w.owner, "nobody@example.com", "viewer"))).toMatchObject({ code: "NOT_FOUND" });
    await addMemberByEmail(w.owner, u.email.toUpperCase(), "viewer");
    expect(await rejects(addMemberByEmail(w.owner, u.email, "viewer"))).toMatchObject({ code: "CONFLICT" });
  });
});
