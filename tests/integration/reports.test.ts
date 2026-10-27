import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { milestonesCsv, tasksCsv, workspaceCsv } from "@/lib/exports/csv";
import { renderProjectPdf, renderWorkspacePdf } from "@/lib/exports/pdf";
import { createMilestone } from "@/server/services/milestones";
import { createProject } from "@/server/services/projects";
import { buildReportData, buildWorkspaceSummary } from "@/server/services/reports";
import { createRisk } from "@/server/services/risks";
import { createTask } from "@/server/services/tasks";
import { publishUpdate } from "@/server/services/updates";
import { milestoneInput, projectInput, riskInput, seedWorkspace, taskInput, useTestDb, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => {
  db = await useTestDb();
});

async function seedProject() {
  const w = await seedWorkspace(db, "Reports", ["owner", "contributor", "viewer"]);
  const p = await createProject(w.owner, projectInput({ title: 'Launch, "Phase 1"', memberIds: [w.contributor.userId], progressWeighting: "equal" }));
  const m = await createMilestone(w.owner, p.id, milestoneInput({ title: "Beta ✨ ready" }));
  await createTask(w.owner, p.id, taskInput({ title: "=cmd|calc", milestoneId: m.id, status: "done", dueDate: "2026-02-01", assigneeId: w.contributor.userId, labels: ["a", "b"] }));
  await createTask(w.owner, p.id, taskInput({ title: "Open task", milestoneId: m.id, dueDate: "2026-03-01", estimateHours: 4 }));
  await createRisk(w.owner, p.id, riskInput({ severity: "critical", title: "Supplier risk" }));
  await publishUpdate(w.owner, p.id, { title: "Kickoff", status: "in_progress", health: "on_track", progressSummary: "Underway\nline two", completedWork: "", nextSteps: "", risksBlockers: "", decisions: "" });
  return { w, p };
}

describe("report export", () => {
  it("builds CSVs from real records, escaped and well formed", async () => {
    const { w, p } = await seedProject();
    const data = await buildReportData(w.viewer, p.id, { today: "2026-02-15" }); // viewers may export
    const tasks = tasksCsv(data);
    const lines = tasks.replace("﻿", "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("Task ID,Title,Status,Priority,Assignee,Milestone,Parent task ID,Start date,Due date,Overdue,Estimate (h),Actual (h),Progress %,Labels,Completed on");
    expect(lines).toHaveLength(3);
    expect(tasks).toContain("'=cmd|calc"); // formula neutralised
    expect(tasks).toContain("a; b");
    expect(tasks).toContain("Beta ✨ ready");
    expect(lines.find((l) => l.includes("Open task"))).toContain(",no,"); // due 2026-03-01 is not yet overdue on 02-15

    const ms = milestonesCsv(data).split("\r\n");
    expect(ms[1]).toContain("Beta ✨ ready");
    expect(ms[1]).toContain(",50,calculated,2,1");
  });

  it("renders a valid multi-section PDF that tolerates characters outside the font", async () => {
    const { w, p } = await seedProject();
    const data = await buildReportData(w.owner, p.id, { today: "2026-02-15" });
    const bytes = await renderProjectPdf(data);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toContain("Launch");
  });

  it("paginates long reports without error", async () => {
    const w = await seedWorkspace(db, "Long", ["owner"]);
    const p = await createProject(w.owner, projectInput({ title: "Big" }));
    for (let i = 0; i < 120; i++) await createTask(w.owner, p.id, taskInput({ title: `Task number ${i} ${"x".repeat(i % 90)}`, dueDate: "2026-03-01" }));
    const bytes = await renderProjectPdf(await buildReportData(w.owner, p.id, { today: "2026-02-15" }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });

  it("honours section selection and the workspace summary capability", async () => {
    const { w, p } = await seedProject();
    const only = await buildReportData(w.owner, p.id, { sections: ["summary"] });
    expect(only.sections).toEqual(["summary"]);
    // Portfolio export is a manager/owner capability.
    await expect(buildWorkspaceSummary(w.contributor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(buildWorkspaceSummary(w.viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const summary = await buildWorkspaceSummary(w.owner, "2026-02-15");
    expect(summary.rows).toHaveLength(1);
    expect(workspaceCsv(summary)).toContain('"Launch, ""Phase 1"""');
    expect(Buffer.from(await renderWorkspacePdf(summary)).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
