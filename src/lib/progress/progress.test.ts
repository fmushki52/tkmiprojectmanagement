import { describe, expect, it } from "vitest";
import {
  type ProgressMilestone,
  type ProgressTask,
  leafTasks,
  milestoneProgress,
  projectProgress,
  taskCounts,
  taskProgress,
  taskWeights,
  weightedAverage,
} from "./index";

let n = 0;
const task = (over: Partial<ProgressTask> = {}): ProgressTask => ({
  id: `t${++n}`,
  status: "todo",
  progress: null,
  estimateHours: null,
  parentTaskId: null,
  milestoneId: "m1",
  ...over,
});
const milestone = (over: Partial<ProgressMilestone> = {}): ProgressMilestone => ({
  id: "m1",
  status: "in_progress",
  progressMode: "calculated",
  manualProgress: null,
  ...over,
});

describe("taskProgress", () => {
  it("uses status defaults", () => {
    expect(taskProgress({ status: "backlog", progress: null })).toBe(0);
    expect(taskProgress({ status: "todo", progress: null })).toBe(0);
    expect(taskProgress({ status: "in_progress", progress: null })).toBe(50);
    expect(taskProgress({ status: "blocked", progress: null })).toBe(0);
    expect(taskProgress({ status: "done", progress: null })).toBe(100);
  });
  it("prefers explicit progress for open tasks, clamped to 0-100", () => {
    expect(taskProgress({ status: "in_progress", progress: 80 })).toBe(80);
    expect(taskProgress({ status: "blocked", progress: 30 })).toBe(30);
    expect(taskProgress({ status: "todo", progress: 0 })).toBe(0);
    expect(taskProgress({ status: "in_progress", progress: 140 })).toBe(100);
  });
  it("always counts done as 100 regardless of explicit progress", () => {
    expect(taskProgress({ status: "done", progress: 20 })).toBe(100);
  });
});

describe("weightedAverage", () => {
  it("handles empty input and zero weight without dividing by zero", () => {
    expect(weightedAverage([])).toBe(0);
    expect(weightedAverage([{ value: 50, weight: 0 }])).toBe(0);
  });
  it("weights values", () => {
    expect(weightedAverage([{ value: 100, weight: 3 }, { value: 0, weight: 1 }])).toBe(75);
  });
});

describe("taskWeights", () => {
  it("is equal in equal mode", () => {
    expect(taskWeights([{ estimateHours: 8 }, { estimateHours: null }], "equal")).toEqual([1, 1]);
  });
  it("uses estimates in effort mode and the mean for missing ones", () => {
    expect(taskWeights([{ estimateHours: 2 }, { estimateHours: 6 }, { estimateHours: null }], "effort")).toEqual([2, 6, 4]);
  });
  it("falls back to equal when nothing is estimated", () => {
    expect(taskWeights([{ estimateHours: null }, { estimateHours: 0 }], "effort")).toEqual([1, 1]);
  });
});

describe("leaf tasks and counts", () => {
  it("excludes parents that have subtasks so work is not double counted", () => {
    const parent = task({ id: "p", status: "in_progress" });
    const a = task({ parentTaskId: "p", status: "done" });
    const b = task({ parentTaskId: "p", status: "todo" });
    expect(leafTasks([parent, a, b]).map((t) => t.id)).toEqual([a.id, b.id]);
    const c = taskCounts([parent, a, b]);
    expect(c).toMatchObject({ total: 2, done: 1, remaining: 1, ratio: 0.5 });
  });
  it("returns zeros for no tasks", () => {
    expect(taskCounts([])).toEqual({ total: 0, done: 0, remaining: 0, inProgress: 0, blocked: 0, ratio: 0 });
  });
});

describe("milestoneProgress", () => {
  it("calculates from equally weighted tasks", () => {
    const tasks = [task({ status: "done" }), task({ status: "in_progress" }), task({ status: "todo" }), task({ status: "todo" })];
    const p = milestoneProgress(milestone(), tasks);
    expect(p).toMatchObject({ percent: 38, source: "calculated", hasData: true });
    expect(p.counts).toMatchObject({ total: 4, done: 1, remaining: 3 });
  });
  it("weights by effort when requested", () => {
    const tasks = [task({ status: "done", estimateHours: 30 }), task({ status: "todo", estimateHours: 10 })];
    expect(milestoneProgress(milestone(), tasks, "equal").percent).toBe(50);
    expect(milestoneProgress(milestone(), tasks, "effort").percent).toBe(75);
  });
  it("reports an empty calculated milestone as 0% with no data, or 100% when completed", () => {
    expect(milestoneProgress(milestone(), [])).toMatchObject({ percent: 0, hasData: false, source: "calculated" });
    expect(milestoneProgress(milestone({ status: "completed" }), [])).toMatchObject({ percent: 100, hasData: false });
  });
  it("uses the manual value in manual mode and labels it as manual, ignoring tasks", () => {
    const m = milestone({ progressMode: "manual", manualProgress: 60 });
    expect(milestoneProgress(m, [task({ status: "done" })])).toMatchObject({ percent: 60, source: "manual" });
  });
});

describe("projectProgress", () => {
  it("returns 0 for an empty project", () => {
    expect(projectProgress([], [])).toMatchObject({ percent: 0, unassigned: null });
  });
  it("averages milestones equally by default (not by task count)", () => {
    const ms = [milestone({ id: "a" }), milestone({ id: "b" })];
    const tasks = [
      task({ milestoneId: "a", status: "done" }),
      task({ milestoneId: "b", status: "todo" }),
      task({ milestoneId: "b", status: "todo" }),
      task({ milestoneId: "b", status: "todo" }),
    ];
    const p = projectProgress(ms, tasks);
    expect(p.milestones.a.percent).toBe(100);
    expect(p.milestones.b.percent).toBe(0);
    expect(p.percent).toBe(50);
  });
  it("weights milestones by total effort in effort mode", () => {
    const ms = [milestone({ id: "a" }), milestone({ id: "b" })];
    const tasks = [
      task({ milestoneId: "a", status: "done", estimateHours: 10 }),
      task({ milestoneId: "b", status: "todo", estimateHours: 30 }),
    ];
    expect(projectProgress(ms, tasks, "effort").percent).toBe(25);
    expect(projectProgress(ms, tasks, "equal").percent).toBe(50);
  });
  it("counts tasks without a milestone as one implicit bucket", () => {
    const ms = [milestone({ id: "a" })];
    const tasks = [task({ milestoneId: "a", status: "done" }), task({ milestoneId: null, status: "todo" })];
    const p = projectProgress(ms, tasks);
    expect(p.unassigned?.percent).toBe(0);
    expect(p.percent).toBe(50);
  });
  it("includes empty milestones at 0% so unplanned work is not reported as done", () => {
    const ms = [milestone({ id: "a" }), milestone({ id: "b" })];
    expect(projectProgress(ms, [task({ milestoneId: "a", status: "done" })]).percent).toBe(50);
  });
  it("gives a taskless manual milestone a fair weight in effort mode", () => {
    const ms = [milestone({ id: "a" }), milestone({ id: "m", progressMode: "manual", manualProgress: 100 })];
    const tasks = [task({ milestoneId: "a", status: "todo", estimateHours: 8 })];
    expect(projectProgress(ms, tasks, "effort").percent).toBe(50);
  });
});
