import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { createMilestone } from "@/server/services/milestones";
import { createProject, deleteProject, getProjectDetail, listProjects, updateProject } from "@/server/services/projects";
import { createRisk, listRisks } from "@/server/services/risks";
import { addComment, listComments } from "@/server/services/comments";
import { createTask, deleteTask, getTaskDetail, listTasks, moveTask, updateTask } from "@/server/services/tasks";
import { editUpdate, listUpdates, publishUpdate, retractUpdate } from "@/server/services/updates";
import { listNotifications } from "@/server/services/notifications";
import { changeMemberRole, listMembers, removeMember, resolveMembership } from "@/server/services/workspaces";
import { buildReportData } from "@/server/services/reports";
import { milestoneInput, projectInput, riskInput, seedUser, seedWorkspace, taskInput, useTestDb, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => {
  db = await useTestDb();
});

const code = (c: string) => expect.objectContaining({ code: c });
const rejects = (p: Promise<unknown>) => p.then(() => null, (e) => e as AppError);

describe("workspace isolation", () => {
  it("never exposes one workspace's data to a member of another, even with valid ids", async () => {
    const a = await seedWorkspace(db, "Acme", ["owner"]);
    const b = await seedWorkspace(db, "Beta", ["owner"]);
    const project = await createProject(a.owner, projectInput({ title: "Secret A" }));
    const milestone = await createMilestone(a.owner, project.id, milestoneInput());
    const task = await createTask(a.owner, project.id, taskInput({ milestoneId: milestone.id }));
    const update = await publishUpdate(a.owner, project.id, {
      title: "Status", status: "in_progress", health: "on_track", progressSummary: "", completedWork: "", nextSteps: "", risksBlockers: "", decisions: "",
    });
    const risk = await createRisk(a.owner, project.id, riskInput());

    // B (an owner of their own workspace) holds A's ids but is scoped to workspace B.
    const attacker = b.owner;
    expect(await rejects(getProjectDetail(attacker, project.id))).toEqual(code("NOT_FOUND"));
    expect(await rejects(updateProject(attacker, project.id, projectInput()))).toEqual(code("NOT_FOUND"));
    expect(await rejects(deleteProject(attacker, project.id))).toEqual(code("NOT_FOUND"));
    expect(await rejects(createMilestone(attacker, project.id, milestoneInput()))).toEqual(code("NOT_FOUND"));
    expect(await rejects(createTask(attacker, project.id, taskInput()))).toEqual(code("NOT_FOUND"));
    expect(await rejects(getTaskDetail(attacker, task.id))).toEqual(code("NOT_FOUND"));
    expect(await rejects(updateTask(attacker, task.id, taskInput({ title: "pwned" })))).toEqual(code("NOT_FOUND"));
    expect(await rejects(moveTask(attacker, task.id, "done", 0))).toEqual(code("NOT_FOUND"));
    expect(await rejects(deleteTask(attacker, task.id))).toEqual(code("NOT_FOUND"));
    expect(await rejects(addComment(attacker, { taskId: task.id }, "hi"))).toEqual(code("NOT_FOUND"));
    expect(await rejects(listComments(attacker, { taskId: task.id }))).toEqual(code("NOT_FOUND"));
    expect(await rejects(publishUpdate(attacker, project.id, { title: "x", status: "planning", health: "on_track", progressSummary: "", completedWork: "", nextSteps: "", risksBlockers: "", decisions: "" }))).toEqual(code("NOT_FOUND"));
    expect(await rejects(editUpdate(attacker, update.id, { title: "x", status: "planning", health: "on_track", progressSummary: "", completedWork: "", nextSteps: "", risksBlockers: "", decisions: "" }))).toEqual(code("NOT_FOUND"));
    expect(await rejects(retractUpdate(attacker, update.id, "no"))).toEqual(code("NOT_FOUND"));
    expect(await rejects(listUpdates(attacker, project.id))).toEqual(code("NOT_FOUND"));
    expect(await rejects(listRisks(attacker, project.id))).toEqual(code("NOT_FOUND"));
    expect(await rejects(buildReportData(attacker, project.id))).toEqual(code("NOT_FOUND"));

    // List endpoints silently return only the caller's own workspace data.
    expect((await listProjects(attacker)).items).toHaveLength(0);
    expect(await listTasks(attacker, { projectId: project.id })).toHaveLength(0);
    expect(risk.workspaceId).toBe(a.workspace.id);

    // Nothing was modified.
    const intact = await getProjectDetail(a.owner, project.id);
    expect(intact.project.title).toBe("Secret A");
    expect((await getTaskDetail(a.owner, task.id)).task.title).toBe("Write homepage copy");
  });

  it("will not attach a task to another workspace's milestone or assign non-members", async () => {
    const a = await seedWorkspace(db, "Gamma", ["owner"]);
    const b = await seedWorkspace(db, "Delta", ["owner"]);
    const pa = await createProject(a.owner, projectInput());
    const pb = await createProject(b.owner, projectInput());
    const mb = await createMilestone(b.owner, pb.id, milestoneInput());
    expect(await rejects(createTask(a.owner, pa.id, taskInput({ milestoneId: mb.id })))).toEqual(code("RULE"));
    expect(await rejects(createTask(a.owner, pa.id, taskInput({ assigneeId: b.owner.userId })))).toEqual(code("RULE"));
    expect(await rejects(createProject(a.owner, projectInput({ ownerId: b.owner.userId })))).toEqual(code("RULE"));
  });

  it("resolves membership only for actual members, identically for missing and foreign workspaces", async () => {
    const a = await seedWorkspace(db, "Epsilon", ["owner"]);
    const stranger = await seedUser(db, "Stranger");
    expect(await resolveMembership(stranger.id, { id: a.workspace.id })).toBeNull();
    expect(await resolveMembership(stranger.id, { slug: a.workspace.slug })).toBeNull();
    expect(await resolveMembership(stranger.id, { id: "00000000-0000-0000-0000-000000000000" })).toBeNull();
    expect(await resolveMembership(a.owner.userId, { slug: a.workspace.slug })).toMatchObject({ role: "owner" });
  });

  it("keeps notifications private to their recipient", async () => {
    const a = await seedWorkspace(db, "Zeta", ["owner", "contributor"]);
    const p = await createProject(a.owner, projectInput());
    await createTask(a.owner, p.id, taskInput({ assigneeId: a.contributor.userId }));
    expect(await listNotifications(a.contributor)).toHaveLength(1);
    expect(await listNotifications(a.owner)).toHaveLength(0);
  });
});

describe("role-based permissions", () => {
  it("enforces the capability matrix server-side", async () => {
    const w = await seedWorkspace(db, "Perms", ["owner", "project_manager", "contributor", "viewer"]);
    // Viewer: read-only.
    expect(await rejects(createProject(w.viewer, projectInput()))).toEqual(code("FORBIDDEN"));
    // Contributor: cannot create/edit projects or milestones.
    expect(await rejects(createProject(w.contributor, projectInput()))).toEqual(code("FORBIDDEN"));
    const project = await createProject(w.project_manager, projectInput());
    expect(await rejects(updateProject(w.contributor, project.id, projectInput()))).toEqual(code("FORBIDDEN"));
    expect(await rejects(createMilestone(w.contributor, project.id, milestoneInput()))).toEqual(code("FORBIDDEN"));
    const milestone = await createMilestone(w.project_manager, project.id, milestoneInput());

    // Contributor may work on tasks, comment, post updates and risks.
    const task = await createTask(w.contributor, project.id, taskInput({ milestoneId: milestone.id }));
    await updateTask(w.contributor, task.id, taskInput({ title: "Renamed", milestoneId: milestone.id, status: "in_progress" }));
    await addComment(w.contributor, { taskId: task.id }, "On it");
    await createRisk(w.contributor, project.id, riskInput());
    expect(await rejects(deleteTask(w.contributor, task.id))).toEqual(code("FORBIDDEN"));

    // Viewer cannot write anything.
    expect(await rejects(createTask(w.viewer, project.id, taskInput()))).toEqual(code("FORBIDDEN"));
    expect(await rejects(updateTask(w.viewer, task.id, taskInput()))).toEqual(code("FORBIDDEN"));
    expect(await rejects(moveTask(w.viewer, task.id, "done", 0))).toEqual(code("FORBIDDEN"));
    expect(await rejects(addComment(w.viewer, { taskId: task.id }, "hi"))).toEqual(code("FORBIDDEN"));
    expect(await rejects(createRisk(w.viewer, project.id, riskInput()))).toEqual(code("FORBIDDEN"));
    // …but can read.
    expect((await getProjectDetail(w.viewer, project.id)).project.id).toBe(project.id);
    expect(await listTasks(w.viewer, { projectId: project.id })).toHaveLength(1);

    // Only owners delete projects; project managers archive/delete tasks.
    expect(await rejects(deleteProject(w.project_manager, project.id))).toEqual(code("FORBIDDEN"));
    await deleteTask(w.project_manager, task.id);
    await deleteProject(w.owner, project.id);
    expect(await rejects(getProjectDetail(w.owner, project.id))).toEqual(code("NOT_FOUND"));
  });

  it("limits who may edit or retract a published update", async () => {
    const w = await seedWorkspace(db, "Updates", ["owner", "project_manager", "contributor", "viewer"]);
    const other = await seedUser(db, "Other contrib");
    await db.insert((await import("@/db/schema")).workspaceMembers).values({ workspaceId: w.workspace.id, userId: other.id, role: "contributor" });
    const otherCtx = { userId: other.id, workspaceId: w.workspace.id, role: "contributor" as const };
    const project = await createProject(w.project_manager, projectInput());
    const input = { title: "Weekly", status: "in_progress" as const, health: "on_track" as const, progressSummary: "ok", completedWork: "", nextSteps: "", risksBlockers: "", decisions: "" };
    const u = await publishUpdate(w.contributor, project.id, input);
    expect(await rejects(publishUpdate(w.viewer, project.id, input))).toEqual(code("FORBIDDEN"));
    // Another contributor can't touch it; the author and a manager can.
    expect(await rejects(editUpdate(otherCtx, u.id, input))).toEqual(code("FORBIDDEN"));
    expect(await rejects(retractUpdate(otherCtx, u.id, "nope"))).toEqual(code("FORBIDDEN"));
    const v2 = await editUpdate(w.contributor, u.id, { ...input, progressSummary: "better" });
    expect(v2.supersedesId).toBe(u.id);
    await retractUpdate(w.project_manager, v2.id, "Superseded by the monthly report");
  });

  it("protects the last owner from demotion or removal", async () => {
    const w = await seedWorkspace(db, "Owners", ["owner", "contributor"]);
    const members = await listMembers(w.owner);
    const ownerRow = members.find((m) => m.userId === w.owner.userId)!;
    expect(await rejects(changeMemberRole(w.owner, ownerRow.id, "viewer"))).toEqual(code("RULE"));
    expect(await rejects(removeMember(w.owner, ownerRow.id))).toEqual(code("RULE"));
    expect(await rejects(changeMemberRole(w.contributor, ownerRow.id, "viewer"))).toEqual(code("FORBIDDEN"));
  });

  it("removing a member releases their assignments", async () => {
    const w = await seedWorkspace(db, "Release", ["owner", "contributor"]);
    const p = await createProject(w.owner, projectInput());
    const t = await createTask(w.owner, p.id, taskInput({ assigneeId: w.contributor.userId }));
    const row = (await listMembers(w.owner)).find((m) => m.userId === w.contributor.userId)!;
    await removeMember(w.owner, row.id);
    expect((await getTaskDetail(w.owner, t.id)).task.assigneeId).toBeNull();
  });
});
