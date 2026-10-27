import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RoleMatrix } from "@/features/workspaces/role-matrix";
import { UsersPanel } from "@/features/workspaces/users-panel";
import { can } from "@/lib/permissions";
import { getWorkspaceCtx } from "@/server/context";
import { listMembersDetailed } from "@/server/services/workspaces";

export const metadata: Metadata = { title: "User management" };

export default async function UsersPage({ params }: PageProps<"/w/[slug]/users">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  // Same capability the service layer enforces; the page simply does not exist for other roles.
  if (!can(ws.role, "member:manage")) notFound();
  const members = await listMembersDetailed(ws);
  return (
    <>
      <PageHeader title="User Management" description={`Members and roles in ${ws.workspaceName}`} />
      <div className="grid gap-6">
        <UsersPanel
          workspaceId={ws.workspaceId}
          currentUserId={ws.userId}
          members={members.map((m) => ({
            id: m.id,
            userId: m.userId,
            name: m.name,
            email: m.email,
            role: m.role,
            joinedAt: m.joinedAt.toISOString(),
            ownedProjects: m.ownedProjects,
            openTasks: m.openTasks,
          }))}
        />
        <RoleMatrix />
      </div>
    </>
  );
}
