import { describe, expect, it } from "vitest";
import { milestoneSchema, projectSchema, taskSchema } from "./index";

const project = {
  title: "Website relaunch",
  description: "",
  scope: "",
  startDate: "2026-01-10",
  plannedEndDate: "2026-03-10",
  actualStartDate: "",
  actualEndDate: "",
  ownerId: "",
  status: "planning",
  priority: "medium",
  health: "",
  color: "#6366f1",
  tags: "web, design, web",
  progressWeighting: "equal",
};

describe("projectSchema dates", () => {
  it("accepts a valid project and normalises optional values", () => {
    const r = projectSchema.safeParse(project);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tags).toEqual(["web", "design"]);
      expect(r.data.health).toBeNull();
      expect(r.data.actualStartDate).toBeNull();
    }
  });
  it("rejects an end date before the start date", () => {
    const r = projectSchema.safeParse({ ...project, plannedEndDate: "2026-01-09" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ["plannedEndDate"], message: /before the start/ });
  });
  it("allows a same-day project", () => {
    expect(projectSchema.safeParse({ ...project, plannedEndDate: "2026-01-10" }).success).toBe(true);
  });
  it("rejects impossible calendar dates and actual end before actual start", () => {
    expect(projectSchema.safeParse({ ...project, startDate: "2026-02-30" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...project, actualStartDate: "2026-02-10", actualEndDate: "2026-02-01" }).success).toBe(false);
  });
  it("requires a title", () => {
    expect(projectSchema.safeParse({ ...project, title: "   " }).success).toBe(false);
  });
});

describe("owner ids", () => {
  // Better Auth user ids are opaque strings, not UUIDs.
  const userId = "sDNSwXlFlecLOx16eoDjF9I0b2W9A2Li";
  it("accepts a non-uuid user id as project and milestone owner", () => {
    expect(projectSchema.safeParse({ ...project, ownerId: userId }).success).toBe(true);
    const m = { title: "Beta", description: "", dueDate: "2026-02-01", actualDate: "", ownerId: userId, status: "not_started", priority: "high", progressMode: "calculated", manualProgress: "" };
    expect(milestoneSchema.safeParse(m).success).toBe(true);
  });
});

describe("taskSchema", () => {
  const task = {
    title: "Draft copy", description: "", status: "todo", priority: "medium", assigneeId: "",
    milestoneId: "", parentTaskId: "", startDate: "2026-02-10", dueDate: "2026-02-01",
    estimateHours: "", actualHours: "", progress: "", labels: "", dependsOn: [],
  };
  it("rejects a due date before the start date", () => {
    expect(taskSchema.safeParse(task).success).toBe(false);
  });
  it("coerces numeric strings and empty values", () => {
    const r = taskSchema.safeParse({ ...task, dueDate: "2026-02-20", estimateHours: "6.5", progress: "40" });
    expect(r.success && r.data).toMatchObject({ estimateHours: 6.5, progress: 40, assigneeId: null, milestoneId: null });
  });
  it("rejects out-of-range progress", () => {
    expect(taskSchema.safeParse({ ...task, dueDate: "2026-02-20", progress: "120" }).success).toBe(false);
  });
});

describe("milestoneSchema", () => {
  const m = { title: "Beta", description: "", dueDate: "2026-02-01", actualDate: "", ownerId: "", status: "not_started", priority: "high", progressMode: "calculated", manualProgress: "" };
  it("requires a manual value in manual mode", () => {
    expect(milestoneSchema.safeParse({ ...m, progressMode: "manual" }).success).toBe(false);
    expect(milestoneSchema.safeParse({ ...m, progressMode: "manual", manualProgress: "40" }).success).toBe(true);
  });
});
