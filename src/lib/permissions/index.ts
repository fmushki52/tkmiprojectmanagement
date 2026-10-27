import { forbidden } from "@/lib/errors";

export const WORKSPACE_ROLES = ["owner", "project_manager", "contributor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  project_manager: "Project manager",
  contributor: "Contributor",
  viewer: "Viewer",
};

export type Action =
  | "workspace:update"
  | "workspace:delete"
  | "member:manage"
  | "project:create"
  | "project:update"
  | "project:archive"
  | "project:delete"
  | "milestone:write"
  | "task:create"
  | "task:update"
  | "task:delete"
  | "comment:write"
  | "update:publish"
  | "update:moderate"
  | "risk:write"
  | "attachment:write"
  | "export:project"
  | "export:workspace";

const VIEWER: Action[] = ["export:project"];
const CONTRIBUTOR: Action[] = [
  ...VIEWER,
  "task:create",
  "task:update",
  "comment:write",
  "update:publish",
  "risk:write",
  "attachment:write",
];
const PROJECT_MANAGER: Action[] = [
  ...CONTRIBUTOR,
  "project:create",
  "project:update",
  "project:archive",
  "milestone:write",
  "task:delete",
  "update:moderate",
  "export:workspace",
];
const OWNER: Action[] = [
  ...PROJECT_MANAGER,
  "project:delete",
  "workspace:update",
  "workspace:delete",
  "member:manage",
];

/**
 * Role capability matrix. Authorization is enforced on the server in every service function via
 * `assertCan`; UI visibility (`can` in components) is a convenience only.
 */
export const ROLE_ACTIONS: Record<WorkspaceRole, ReadonlySet<Action>> = {
  viewer: new Set(VIEWER),
  contributor: new Set(CONTRIBUTOR),
  project_manager: new Set(PROJECT_MANAGER),
  owner: new Set(OWNER),
};

export function can(role: WorkspaceRole, action: Action): boolean {
  return ROLE_ACTIONS[role].has(action);
}

export function assertCan(role: WorkspaceRole, action: Action): void {
  if (!can(role, action)) throw forbidden();
}

/**
 * Editing or retracting a published project update: the author may do so for their own update
 * (they must still be able to publish); project managers/owners may moderate any update.
 */
export function canModifyUpdate(role: WorkspaceRole, authorId: string | null, userId: string): boolean {
  if (can(role, "update:moderate")) return true;
  return can(role, "update:publish") && authorId === userId;
}

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Full control: members and roles, workspace settings, deleting projects and the workspace.",
  project_manager: "Creates and manages projects, milestones and reports; moderates updates and comments.",
  contributor: "Works on tasks, comments, posts updates, registers risks and uploads files.",
  viewer: "Read-only access to projects, tasks and reports, with the ability to export a project.",
};

/** Human-readable capability groups for the role matrix. Every row is evaluated with `can()`, so the matrix can never drift from enforcement. */
export const CAPABILITY_GROUPS: { group: string; rows: { label: string; action: Action }[] }[] = [
  {
    group: "Workspace",
    rows: [
      { label: "Manage members and roles", action: "member:manage" },
      { label: "Rename workspace", action: "workspace:update" },
      { label: "Delete workspace", action: "workspace:delete" },
    ],
  },
  {
    group: "Projects",
    rows: [
      { label: "Create projects", action: "project:create" },
      { label: "Edit projects", action: "project:update" },
      { label: "Archive projects", action: "project:archive" },
      { label: "Delete projects", action: "project:delete" },
      { label: "Create and edit milestones", action: "milestone:write" },
    ],
  },
  {
    group: "Work",
    rows: [
      { label: "Create tasks", action: "task:create" },
      { label: "Update and move tasks", action: "task:update" },
      { label: "Delete tasks", action: "task:delete" },
      { label: "Comment", action: "comment:write" },
      { label: "Publish project updates", action: "update:publish" },
      { label: "Register risks and blockers", action: "risk:write" },
      { label: "Upload attachments", action: "attachment:write" },
      { label: "Moderate updates, comments, risks and files", action: "update:moderate" },
    ],
  },
  {
    group: "Reports",
    rows: [
      { label: "Export a project (PDF/CSV)", action: "export:project" },
      { label: "Export workspace summary", action: "export:workspace" },
    ],
  },
];
