import { beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/db";
import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { listProjectActivity } from "@/server/services/activity";
import { addComment } from "@/server/services/comments";
import { createMilestone, deleteMilestone, listMilestones, reorderMilestones, updateMilestone } from "@/server/services/milestones";
import { listNotifications, syncDeadlineNotifications, unreadCount, markAllRead } from "@/server/services/notifications";
import { createProject, deleteProject, getProjectDetail, getProjectMetrics, listProjects, requireProject, setProjectArchived, updateProject } from "@/server/services/projects";
import { createRisk } from "@/server/services/risks";
import { createTask, getTaskDetail, listTasks, moveTask, quickCreateTask, updateTask } from "@/server/services/tasks";
import { editUpdate, listUpdates, publishUpdate, retractUpdate } from "@/server/services/updates";
import { milestoneInput, projectInput, riskInput, seedWorkspace, taskInput, useTestDb, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => {
  db = await useTestDb();
});

const err = (p: Promise<unknown>) => p.then(() => null, (e) => e as AppError);

describe("project CRUD", () => {
  it("creates, reads, updates, archives and deletes with an activity trail", async () => {
    const w = await seedWorkspace(db, "Crud", ["owner", "contributor"]);
    const p = await createProject(w.owner, projectInput({ title: "Alpha", tags: ["x"], memberIds: [w.contributor.userId], status: "planning" }));
    expect(p.ownerId).toBe(w.owner.userId); // defaults to the creator
    const detail = await getProjectDetail(w.owner, p.id);
    expect(detail.members.map((m) => m.userId).sort()).toEqual([w.owner.userId, w.contributor.userId].sort());

    const updated = await updateProject(w.owner, p.id, projectInput({ title: "Alpha 2", status: "in_progress", plannedEndDate: "2026-09-30", ownerId: w.owner.userId, memberIds: [w.contributor.userId] }));
    expect(updated).toMatchObject({ title: "Alpha 2", status: "in_progress" });
    expect(updated.actualStartDate).toBeTruthy(); // stamped on first move to in_progress

    const actions = (await listProjectActivity(w.owner, p.id)).map((a) => `${a.entityType}.${a.action}`);
    expect(actions).toEqual(expect.arrayContaining(["project.created", "project.updated", "project.status_changed", "project.dates_changed"]));
    // The team member was told about the status change; the actor was not.
    expect((await listNotifications(w.contributor)).some((n) => n.type === "project_status_changed")).toBe(true);
    expect((await listNotifications(w.owner)).some((n) => n.type === "project_status_changed")).toBe(false);

    await setProjectArchived(w.owner, p.id, true);
    expect((await listProjects(w.owner)).items).toHaveLength(0);
    expect((await listProjects(w.owner, { scope: "archived" })).items).toHaveLength(1);
    await setProjectArchived(w.owner, p.id, false);

    await deleteProject(w.owner, p.id);
    expect(await err(requireProject(db as never, w.owner, p.id))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an end date before the start date at the database level too", async () => {
    const w = await seedWorkspace(db, "DateCk", ["owner"]);
    await expect(
      db.insert(schema.projects).values({ workspaceId: w.workspace.id, title: "bad", startDate: "2026-02-01", plannedEndDate: "2026-01-01" }),
    ).rejects.toThrow();
  });

  it("searches, filters, sorts and paginates", async () => {
    const w = await seedWorkspace(db, "List", ["owner"]);
    for (let i = 1; i <= 5; i++) {
      await createProject(w.owner, projectInput({ title: `Project ${i}`, description: i === 3 ? "needle in here" : "", priority: i % 2 ? "low" : "critical", status: i === 5 ? "on_hold" : "in_progress", tags: i === 2 ? ["urgent-tag"] : [] }));
    }
    const all = await listProjects(w.owner, { pageSize: 2, sort: "title", dir: "asc" });
    expect(all).toMatchObject({ total: 5, pageCount: 3 });
    expect(all.items.map((i) => i.project.title)).toEqual(["Project 1", "Project 2"]);
    expect((await listProjects(w.owner, { pageSize: 2, page: 3, sort: "title", dir: "asc" })).items.map((i) => i.project.title)).toEqual(["Project 5"]);
    expect((await listProjects(w.owner, { q: "needle" })).items.map((i) => i.project.title)).toEqual(["Project 3"]);
    expect((await listProjects(w.owner, { q: "urgent-tag" })).items.map((i) => i.project.title)).toEqual(["Project 2"]);
    expect((await listProjects(w.owner, { status: "on_hold" })).total).toBe(1);
    expect((await listProjects(w.owner, { priority: "critical", sort: "priority", dir: "desc" })).total).toBe(2);
    // LIKE wildcards in the search box are treated literally.
    expect((await listProjects(w.owner, { q: "%" })).total).toBe(0);
  });
});

describe("progress recalculation and milestone status", () => {
  it("derives milestone and project completion from tasks and auto-completes milestones", async () => {
    const w = await seedWorkspace(db, "Progress", ["owner", "contributor"]);
    const p = await createProject(w.owner, projectInput({ memberIds: [w.contributor.userId] }));
    const m1 = await createMilestone(w.owner, p.id, milestoneInput({ title: "M1" }));
    const m2 = await createMilestone(w.owner, p.id, milestoneInput({ title: "M2", dueDate: "2026-05-01" }));
    const a = await createTask(w.contributor, p.id, taskInput({ title: "A", milestoneId: m1.id }));
    const b = await createTask(w.contributor, p.id, taskInput({ title: "B", milestoneId: m1.id }));
    await createTask(w.contributor, p.id, taskInput({ title: "C", milestoneId: m2.id }));

    let { metrics } = await getProjectMetrics(db as never, w.owner, p);
    expect(metrics.progress).toBe(0);
    expect(metrics.counts).toMatchObject({ total: 3, done: 0, remaining: 3 });

    await updateTask(w.contributor, a.id, taskInput({ title: "A", milestoneId: m1.id, status: "done" }));
    ({ metrics } = await getProjectMetrics(db as never, w.owner, p));
    expect(metrics.milestones[m1.id].percent).toBe(50);
    expect(metrics.progress).toBe(25); // (50 + 0) / 2 milestones
    expect((await listMilestones(w.owner, p.id)).find((r) => r.milestone.id === m1.id)?.milestone.status).toBe("in_progress");

    await moveTask(w.contributor, b.id, "done", 0);
    ({ metrics } = await getProjectMetrics(db as never, w.owner, p));
    expect(metrics.milestones[m1.id].percent).toBe(100);
    expect(metrics.progress).toBe(50);
    const done = (await listMilestones(w.owner, p.id)).find((r) => r.milestone.id === m1.id)!.milestone;
    expect(done.status).toBe("completed");
    expect(done.actualDate).toBeTruthy();
    // Completion is announced to the team (not to the person who completed it).
    expect((await listNotifications(w.owner)).some((n) => n.type === "milestone_completed")).toBe(true);
    expect((await listNotifications(w.contributor)).some((n) => n.type === "milestone_completed")).toBe(false);

    // Reopening a task reopens the milestone.
    await moveTask(w.contributor, b.id, "in_progress", 0);
    const reopened = (await listMilestones(w.owner, p.id)).find((r) => r.milestone.id === m1.id)!.milestone;
    expect(reopened).toMatchObject({ status: "in_progress", actualDate: null });
  });

  it("refuses to manually complete a milestone with open tasks, and supports an explicit manual mode", async () => {
    const w = await seedWorkspace(db, "Manual", ["owner"]);
    const p = await createProject(w.owner, projectInput());
    const m = await createMilestone(w.owner, p.id, milestoneInput());
    await createTask(w.owner, p.id, taskInput({ milestoneId: m.id }));
    expect(await err(updateMilestone(w.owner, m.id, milestoneInput({ status: "completed" })))).toMatchObject({ code: "RULE" });

    await updateMilestone(w.owner, m.id, milestoneInput({ progressMode: "manual", manualProgress: 40, status: "in_progress" }));
    const row = (await listMilestones(w.owner, p.id))[0];
    expect(row.progress).toMatchObject({ percent: 40, source: "manual" });
    expect((await getProjectMetrics(db as never, w.owner, p)).metrics.progress).toBe(40);
    expect(await err(updateMilestone(w.owner, m.id, milestoneInput({ progressMode: "manual", manualProgress: 40, status: "completed" })))).toMatchObject({ code: "RULE" });
  });

  it("uses effort weighting when the project is configured for it", async () => {
    const w = await seedWorkspace(db, "Effort", ["owner"]);
    const p = await createProject(w.owner, projectInput({ progressWeighting: "effort" }));
    const m = await createMilestone(w.owner, p.id, milestoneInput());
    await createTask(w.owner, p.id, taskInput({ milestoneId: m.id, status: "done", estimateHours: 30 }));
    await createTask(w.owner, p.id, taskInput({ title: "other", milestoneId: m.id, estimateHours: 10 }));
    expect((await getProjectMetrics(db as never, w.owner, p)).metrics.progress).toBe(75);
    await updateProject(w.owner, p.id, projectInput({ progressWeighting: "equal" }));
    const fresh = await requireProject(db as never, w.owner, p.id);
    expect((await getProjectMetrics(db as never, w.owner, fresh)).metrics.progress).toBe(50);
  });

  it("keeps tasks (unassigned) when a milestone is deleted and reorders milestones", async () => {
    const w = await seedWorkspace(db, "Reorder", ["owner"]);
    const p = await createProject(w.owner, projectInput());
    const a = await createMilestone(w.owner, p.id, milestoneInput({ title: "A" }));
    const b = await createMilestone(w.owner, p.id, milestoneInput({ title: "B" }));
    await reorderMilestones(w.owner, p.id, [b.id, a.id]);
    expect((await listMilestones(w.owner, p.id)).map((r) => r.milestone.title)).toEqual(["B", "A"]);
    expect(await err(reorderMilestones(w.owner, p.id, [a.id]))).toMatchObject({ code: "RULE" });
    const t = await createTask(w.owner, p.id, taskInput({ milestoneId: a.id }));
    await deleteMilestone(w.owner, a.id);
    expect((await getTaskDetail(w.owner, t.id)).task.milestoneId).toBeNull();
  });
});

describe("task rules", () => {
  it("blocks completion until dependencies and subtasks are done, and rejects dependency cycles", async () => {
    const w = await seedWorkspace(db, "Deps", ["owner"]);
    const p = await createProject(w.owner, projectInput());
    const a = await createTask(w.owner, p.id, taskInput({ title: "A" }));
    const b = await createTask(w.owner, p.id, taskInput({ title: "B", dependsOn: [a.id] }));
    expect(await err(moveTask(w.owner, b.id, "done", 0))).toMatchObject({ code: "RULE", message: expect.stringMatching(/depends on/) });
    await moveTask(w.owner, a.id, "done", 0);
    await moveTask(w.owner, b.id, "done", 0);
    // a depends on b would close the loop a <- b <- a
    expect(await err(updateTask(w.owner, a.id, taskInput({ title: "A", status: "done", dependsOn: [b.id] })))).toMatchObject({ code: "RULE", message: expect.stringMatching(/cycle/) });
    expect(await err(updateTask(w.owner, a.id, taskInput({ title: "A", status: "done", dependsOn: [a.id] })))).toMatchObject({ code: "RULE" });

    const parent = await createTask(w.owner, p.id, taskInput({ title: "Parent" }));
    const sub = await createTask(w.owner, p.id, taskInput({ title: "Sub", parentTaskId: parent.id }));
    expect(await err(moveTask(w.owner, parent.id, "done", 0))).toMatchObject({ code: "RULE", message: expect.stringMatching(/subtask/) });
    await moveTask(w.owner, sub.id, "done", 0);
    await moveTask(w.owner, parent.id, "done", 0);
    // No grandchildren.
    expect(await err(createTask(w.owner, p.id, taskInput({ parentTaskId: sub.id })))).toMatchObject({ code: "RULE" });
  });

  it("persists Kanban moves: status, completion timestamp and column order", async () => {
    const w = await seedWorkspace(db, "Kanban", ["owner"]);
    const p = await createProject(w.owner, projectInput());
    const t1 = await quickCreateTask(w.owner, p.id, { title: "one", milestoneId: null, status: "todo" });
    const t2 = await quickCreateTask(w.owner, p.id, { title: "two", milestoneId: null, status: "todo" });
    const t3 = await quickCreateTask(w.owner, p.id, { title: "three", milestoneId: null, status: "todo" });
    const order = async (status: "todo" | "done") =>
      (await listTasks(w.owner, { projectId: p.id, status, sort: "updated" })).sort((a, b) => a.task.position - b.task.position).map((r) => r.task.title);
    expect(await order("todo")).toEqual(["one", "two", "three"]);

    await moveTask(w.owner, t3.id, "todo", 0); // reorder within a column
    expect(await order("todo")).toEqual(["three", "one", "two"]);
    await moveTask(w.owner, t1.id, "todo", 3); // to the end
    expect(await order("todo")).toEqual(["three", "two", "one"]);

    const done = await moveTask(w.owner, t2.id, "done", 0);
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeInstanceOf(Date);
    const back = await moveTask(w.owner, t2.id, "in_progress", 0);
    expect(back.completedAt).toBeNull();
    const acts = (await listProjectActivity(w.owner, p.id)).filter((a) => a.action === "status_changed");
    expect(acts.length).toBeGreaterThanOrEqual(2);
  });

  it("filters and sorts task lists", async () => {
    const w = await seedWorkspace(db, "Filters", ["owner", "contributor"]);
    const p = await createProject(w.owner, projectInput());
    await createTask(w.owner, p.id, taskInput({ title: "late", dueDate: "2020-01-01", assigneeId: w.contributor.userId, priority: "critical", labels: ["bug", "ui"] }));
    await createTask(w.owner, p.id, taskInput({ title: "later", dueDate: "2099-01-01", priority: "low" }));
    await createTask(w.owner, p.id, taskInput({ title: "finished", dueDate: "2020-01-01", status: "done" }));
    const titles = async (f: Parameters<typeof listTasks>[1]) => (await listTasks(w.owner, { projectId: p.id, ...f })).map((r) => r.task.title);
    expect(await titles({ due: "overdue" })).toEqual(["late"]); // done tasks are never overdue
    expect(await titles({ assigneeId: w.contributor.userId })).toEqual(["late"]);
    expect(await titles({ assigneeId: "unassigned", status: "open" })).toEqual(["later"]);
    expect(await titles({ priority: "critical" })).toEqual(["late"]);
    expect(await titles({ sort: "priority", dir: "desc" })).toEqual(["late", "finished", "later"]); // critical, medium, low
    expect(await titles({ q: "FINISH" })).toEqual(["finished"]);
    const late = (await listTasks(w.owner, { projectId: p.id, q: "late" })).find((r) => r.task.title === "late")!;
    expect(late.labels.map((l) => l.name).sort()).toEqual(["bug", "ui"]);
  });
});

describe("collaboration", () => {
  const upd = { title: "Week 1", status: "in_progress" as const, health: "on_track" as const, progressSummary: "Going well", completedWork: "", nextSteps: "", risksBlockers: "", decisions: "" };

  it("keeps published updates append-only, with revisions and retraction recorded", async () => {
    const w = await seedWorkspace(db, "Journal", ["owner"]);
    const p = await createProject(w.owner, projectInput());
    const m = await createMilestone(w.owner, p.id, milestoneInput());
    await createTask(w.owner, p.id, taskInput({ milestoneId: m.id, status: "done" }));
    const v1 = await publishUpdate(w.owner, p.id, upd);
    expect(v1.progressSnapshot).toBe(100); // real calculated progress at publish time
    const v2 = await editUpdate(w.owner, v1.id, { ...upd, progressSummary: "Revised" });
    const rows = await db.select().from(schema.projectUpdates).where(eq(schema.projectUpdates.projectId, p.id));
    expect(rows).toHaveLength(2); // the original is kept
    expect(rows.find((r) => r.id === v1.id)?.supersededAt).toBeTruthy();
    expect(await err(editUpdate(w.owner, v1.id, upd))).toMatchObject({ code: "RULE" });
    expect(await err(retractUpdate(w.owner, v2.id, "  "))).toMatchObject({ code: "RULE" });
    await retractUpdate(w.owner, v2.id, "Published to the wrong project");
    const listed = await listUpdates(w.owner, p.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ revisions: 1 });
    expect(listed[0].update).toMatchObject({ retractReason: "Published to the wrong project", retractedById: w.owner.userId });
    const actions = (await listProjectActivity(w.owner, p.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["published", "edited", "retracted"]));
  });

  it("notifies assignees, mentioned people and watchers without self-notifying", async () => {
    const w = await seedWorkspace(db, "Notify", ["owner", "contributor", "viewer"]);
    const p = await createProject(w.owner, projectInput());
    const t = await createTask(w.owner, p.id, taskInput({ assigneeId: w.contributor.userId }));
    expect((await listNotifications(w.contributor)).map((n) => n.type)).toEqual(["task_assigned"]);
    await createTask(w.contributor, p.id, taskInput({ assigneeId: w.contributor.userId })); // self-assignment: no notice
    expect(await unreadCount(w.contributor)).toBe(1);

    await addComment(w.owner, { taskId: t.id }, `Looks good @${w.viewer.name}, thanks!`);
    expect((await listNotifications(w.viewer)).map((n) => n.type)).toEqual(["mention"]);
    expect((await listNotifications(w.contributor)).map((n) => n.type).sort()).toEqual(["comment", "task_assigned"]);
    expect(await listNotifications(w.owner, { unreadOnly: true })).toHaveLength(0);
    await markAllRead(w.contributor);
    expect(await unreadCount(w.contributor)).toBe(0);
  });

  it("generates deadline and overdue notifications once per task per state", async () => {
    const w = await seedWorkspace(db, "Deadlines", ["owner", "contributor"]);
    const p = await createProject(w.owner, projectInput());
    await createTask(w.owner, p.id, taskInput({ title: "Soon", dueDate: "2026-04-11", assigneeId: w.contributor.userId }));
    await createTask(w.owner, p.id, taskInput({ title: "Late", dueDate: "2026-04-01", assigneeId: w.contributor.userId }));
    await createTask(w.owner, p.id, taskInput({ title: "Far", dueDate: "2026-06-01", assigneeId: w.contributor.userId }));
    await createTask(w.owner, p.id, taskInput({ title: "Done", dueDate: "2026-04-01", assigneeId: w.contributor.userId, status: "done" }));
    const before = (await listNotifications(w.contributor)).length;
    expect(await syncDeadlineNotifications(w.workspace.id, "2026-04-10")).toBe(2);
    expect(await syncDeadlineNotifications(w.workspace.id, "2026-04-10")).toBe(0); // idempotent
    const types = (await listNotifications(w.contributor)).map((n) => n.type);
    expect(types.filter((t) => t === "task_overdue")).toHaveLength(1);
    expect(types.filter((t) => t === "deadline_upcoming")).toHaveLength(1);
    expect(types.length).toBe(before + 2);
  });

  it("surfaces open critical risks in project metrics and marks health", async () => {
    const w = await seedWorkspace(db, "Risks", ["owner"]);
    const p = await createProject(w.owner, projectInput({ startDate: "2026-01-01", plannedEndDate: "2026-12-31" }));
    expect((await getProjectMetrics(db as never, w.owner, p, "2026-01-02")).metrics.health).toBe("on_track");
    const r = await createRisk(w.owner, p.id, riskInput({ severity: "critical", kind: "blocker", targetDate: "2026-01-01" }));
    const { metrics } = await getProjectMetrics(db as never, w.owner, p, "2026-01-02");
    expect(metrics).toMatchObject({ openCriticalRisks: 1, overdueCriticalRisks: 1, health: "off_track" });
    expect(r.resolvedAt).toBeNull();
  });
});
