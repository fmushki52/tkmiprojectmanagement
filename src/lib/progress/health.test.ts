import { describe, expect, it } from "vitest";
import { buildBurnup } from "./burnup";
import { type HealthInput, computeHealth, timeElapsedPercent } from "./health";

const base: HealthInput = {
  status: "in_progress",
  progress: 50,
  startDate: "2026-01-01",
  plannedEndDate: "2026-01-31",
  today: "2026-01-16",
  openTaskCount: 10,
  overdueTaskCount: 0,
  overdueMilestoneCount: 0,
  blockedTaskCount: 0,
  openCriticalRiskCount: 0,
  overdueCriticalRiskCount: 0,
};

describe("timeElapsedPercent", () => {
  it("is 0 before the start, 100 after the end, linear between", () => {
    expect(timeElapsedPercent("2026-01-11", "2026-01-21", "2026-01-01")).toBe(0);
    expect(timeElapsedPercent("2026-01-11", "2026-01-21", "2026-01-16")).toBe(50);
    expect(timeElapsedPercent("2026-01-11", "2026-01-21", "2026-02-01")).toBe(100);
  });
  it("handles a single-day project", () => {
    expect(timeElapsedPercent("2026-01-11", "2026-01-11", "2026-01-11")).toBe(0);
    expect(timeElapsedPercent("2026-01-11", "2026-01-11", "2026-01-12")).toBe(100);
  });
});

describe("computeHealth", () => {
  it("is on track when progress matches elapsed time and nothing is flagged", () => {
    expect(computeHealth(base)).toMatchObject({ health: "on_track", reasons: [] });
  });
  it("is not applicable for completed and cancelled projects", () => {
    expect(computeHealth({ ...base, status: "completed" }).health).toBeNull();
    expect(computeHealth({ ...base, status: "cancelled" }).health).toBeNull();
  });
  it("is at risk when 10+ points behind schedule", () => {
    const r = computeHealth({ ...base, progress: 38 }); // elapsed 50%
    expect(r.health).toBe("at_risk");
    expect(r.reasons[0]).toMatch(/behind schedule/);
  });
  it("is off track when 25+ points behind", () => {
    expect(computeHealth({ ...base, progress: 20 }).health).toBe("off_track");
  });
  it("is off track once the planned end date has passed unfinished", () => {
    const r = computeHealth({ ...base, today: "2026-02-05", progress: 90 });
    expect(r.health).toBe("off_track");
    expect(r.reasons[0]).toMatch(/Planned end date passed 5 day/);
  });
  it("is at risk with an overdue milestone, blocked task or open critical risk", () => {
    expect(computeHealth({ ...base, overdueMilestoneCount: 1 }).health).toBe("at_risk");
    expect(computeHealth({ ...base, blockedTaskCount: 1 }).health).toBe("at_risk");
    expect(computeHealth({ ...base, openCriticalRiskCount: 1 }).health).toBe("at_risk");
  });
  it("is off track when a critical risk is past its target date", () => {
    expect(computeHealth({ ...base, openCriticalRiskCount: 1, overdueCriticalRiskCount: 1 }).health).toBe("off_track");
  });
  it("flags many overdue tasks", () => {
    expect(computeHealth({ ...base, overdueTaskCount: 3 }).health).toBe("at_risk");
    expect(computeHealth({ ...base, overdueTaskCount: 2 }).health).toBe("on_track");
  });
  it("flags schedule risk when the end is near with lots of work left", () => {
    const r = computeHealth({ ...base, today: "2026-01-25", progress: 69 });
    expect(r.health).toBe("at_risk");
    expect(r.reasons.join(" ")).toMatch(/Planned end in 6 day/);
  });
  it("does not flag schedule risk before the project starts", () => {
    expect(computeHealth({ ...base, today: "2025-12-25", progress: 0, plannedEndDate: "2026-01-05" }).health).toBe("on_track");
  });
});

describe("buildBurnup", () => {
  const d = (s: string) => new Date(`${s}T12:00:00`);
  it("reports insufficient data instead of inventing history", () => {
    expect(buildBurnup([{ dueDate: null, completedAt: null }], "2026-01-01", "2026-01-31", "2026-01-15")).toEqual({
      sufficient: false,
      reason: expect.stringMatching(/at least 2 tasks/),
    });
    const notStarted = buildBurnup(
      [{ dueDate: "2026-01-05", completedAt: null }, { dueDate: "2026-01-09", completedAt: null }],
      "2026-01-10",
      "2026-01-31",
      "2026-01-10",
    );
    expect(notStarted.sufficient).toBe(false);
  });
  it("computes planned from due dates and actual from completion timestamps", () => {
    const r = buildBurnup(
      [
        { dueDate: "2026-01-10", completedAt: d("2026-01-09") },
        { dueDate: "2026-01-20", completedAt: null },
        { dueDate: null, completedAt: null },
        { dueDate: "2026-01-30", completedAt: null },
      ],
      "2026-01-01",
      "2026-01-31",
      "2026-01-15",
    );
    expect(r.sufficient).toBe(true);
    if (!r.sufficient) return;
    const at = (date: string) => r.points.find((p) => p.date === date);
    expect(r.points[0]).toMatchObject({ date: "2026-01-01", planned: 0, actual: 0 });
    expect(at("2026-01-15")).toMatchObject({ planned: 25, actual: 25 });
    expect(r.points.at(-1)).toMatchObject({ date: "2026-01-31", planned: 75, actual: null });
    expect(r.points.filter((p) => p.date > "2026-01-15").every((p) => p.actual === null)).toBe(true);
  });
});
