import { describe, expect, it } from "vitest";
import { CAPABILITY_GROUPS, ROLE_ACTIONS, WORKSPACE_ROLES, can, canModifyUpdate } from "./index";

describe("role matrix", () => {
  it("is strictly cumulative: each role can do everything the role below it can", () => {
    const order = ["viewer", "contributor", "project_manager", "owner"] as const;
    for (let i = 1; i < order.length; i++) {
      for (const action of ROLE_ACTIONS[order[i - 1]]) expect(can(order[i], action)).toBe(true);
      expect(ROLE_ACTIONS[order[i]].size).toBeGreaterThan(ROLE_ACTIONS[order[i - 1]].size);
    }
  });

  it("only owners manage members and workspaces; only project managers and up manage projects", () => {
    expect(WORKSPACE_ROLES.filter((r) => can(r, "member:manage"))).toEqual(["owner"]);
    expect(WORKSPACE_ROLES.filter((r) => can(r, "workspace:delete"))).toEqual(["owner"]);
    expect(WORKSPACE_ROLES.filter((r) => can(r, "project:create"))).toEqual(["owner", "project_manager"]);
    expect(WORKSPACE_ROLES.filter((r) => can(r, "task:update"))).toEqual(["owner", "project_manager", "contributor"]);
    expect(can("viewer", "export:project")).toBe(true);
    expect(can("viewer", "comment:write")).toBe(false);
  });

  it("documents every capability in the UI matrix (no drift from enforcement)", () => {
    const documented = new Set(CAPABILITY_GROUPS.flatMap((g) => g.rows.map((r) => r.action)));
    for (const action of ROLE_ACTIONS.owner) expect(documented.has(action), `${action} missing from CAPABILITY_GROUPS`).toBe(true);
  });

  it("lets authors modify their own updates and moderators any update", () => {
    expect(canModifyUpdate("contributor", "u1", "u1")).toBe(true);
    expect(canModifyUpdate("contributor", "u1", "u2")).toBe(false);
    expect(canModifyUpdate("viewer", "u1", "u1")).toBe(false);
    expect(canModifyUpdate("project_manager", "u1", "u2")).toBe(true);
  });
});
