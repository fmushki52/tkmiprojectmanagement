import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  assertMilestoneStatusChange,
  projectStatusEffects,
  resolveTaskStatusChange,
  syncCalculatedMilestone,
} from "./transitions";

const now = new Date("2026-03-01T10:00:00Z");

describe("resolveTaskStatusChange", () => {
  const base = { from: "todo" as const, to: "in_progress" as const, unfinishedDependencies: 0, unfinishedSubtasks: 0, now, completedAt: null };
  it("allows free movement between open statuses and clears completedAt", () => {
    expect(resolveTaskStatusChange(base)).toEqual({ completedAt: null });
    expect(resolveTaskStatusChange({ ...base, from: "done", to: "todo", completedAt: now })).toEqual({ completedAt: null });
  });
  it("stamps completedAt when completing", () => {
    expect(resolveTaskStatusChange({ ...base, to: "done" })).toEqual({ completedAt: now });
  });
  it("keeps the original completedAt when already done", () => {
    const earlier = new Date("2026-02-01T00:00:00Z");
    expect(resolveTaskStatusChange({ ...base, from: "done", to: "done", completedAt: earlier })).toEqual({ completedAt: earlier });
  });
  it("blocks completion while dependencies or subtasks are unfinished", () => {
    expect(() => resolveTaskStatusChange({ ...base, to: "done", unfinishedDependencies: 1 })).toThrow(AppError);
    expect(() => resolveTaskStatusChange({ ...base, to: "done", unfinishedSubtasks: 2 })).toThrow(/subtask/);
  });
});

describe("assertMilestoneStatusChange", () => {
  it("only restricts completion", () => {
    expect(() => assertMilestoneStatusChange({ to: "at_risk", progressMode: "calculated", percent: 10, taskCount: 3 })).not.toThrow();
  });
  it("requires 100% for calculated milestones that have tasks", () => {
    expect(() => assertMilestoneStatusChange({ to: "completed", progressMode: "calculated", percent: 80, taskCount: 3 })).toThrow(/All tasks/);
    expect(() => assertMilestoneStatusChange({ to: "completed", progressMode: "calculated", percent: 100, taskCount: 3 })).not.toThrow();
    expect(() => assertMilestoneStatusChange({ to: "completed", progressMode: "calculated", percent: 0, taskCount: 0 })).not.toThrow();
  });
  it("requires manual progress of 100% in manual mode", () => {
    expect(() => assertMilestoneStatusChange({ to: "completed", progressMode: "manual", percent: 90, taskCount: 0 })).toThrow();
    expect(() => assertMilestoneStatusChange({ to: "completed", progressMode: "manual", percent: 100, taskCount: 0 })).not.toThrow();
  });
});

describe("syncCalculatedMilestone", () => {
  const base = { status: "in_progress" as const, progressMode: "calculated" as const, percent: 100, taskCount: 3, anyStarted: true, actualDate: null, today: "2026-03-01" };
  it("completes a milestone when every task is done", () => {
    expect(syncCalculatedMilestone(base)).toEqual({ status: "completed", actualDate: "2026-03-01" });
  });
  it("is a no-op when already completed", () => {
    expect(syncCalculatedMilestone({ ...base, status: "completed" })).toBeNull();
  });
  it("reopens a completed milestone when work is added or reopened", () => {
    expect(syncCalculatedMilestone({ ...base, status: "completed", percent: 66, actualDate: "2026-02-20" })).toEqual({ status: "in_progress", actualDate: null });
  });
  it("starts a not-started milestone once a task starts", () => {
    expect(syncCalculatedMilestone({ ...base, status: "not_started", percent: 20 })).toEqual({ status: "in_progress", actualDate: null });
  });
  it("leaves at-risk milestones and manual/empty milestones alone", () => {
    expect(syncCalculatedMilestone({ ...base, status: "at_risk", percent: 50 })).toBeNull();
    expect(syncCalculatedMilestone({ ...base, progressMode: "manual" })).toBeNull();
    expect(syncCalculatedMilestone({ ...base, taskCount: 0 })).toBeNull();
  });
});

describe("projectStatusEffects", () => {
  it("stamps actual dates and clears the end date when reopened", () => {
    const planned = { status: "planning" as const, actualStartDate: null, actualEndDate: null };
    expect(projectStatusEffects(planned, "in_progress", "2026-03-01")).toEqual({ actualStartDate: "2026-03-01", actualEndDate: null });
    expect(projectStatusEffects({ ...planned, status: "in_progress", actualStartDate: "2026-02-01" }, "completed", "2026-03-01")).toEqual({
      actualStartDate: "2026-02-01",
      actualEndDate: "2026-03-01",
    });
    expect(projectStatusEffects({ status: "completed", actualStartDate: "2026-02-01", actualEndDate: "2026-03-01" }, "in_progress", "2026-03-05")).toEqual({
      actualStartDate: "2026-02-01",
      actualEndDate: null,
    });
  });
});
