import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsPanel } from "@/features/workspaces/settings-panel";
import { can } from "@/lib/permissions";
import { getWorkspaceCtx } from "@/server/context";
import { listMembers } from "@/server/services/workspaces";

export const metadata: Metadata = { title: "Workspace settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  const members = await listMembers(ws);
  return (
    <>
      <PageHeader title="Workspace settings" description={ws.workspaceName} />
      <SettingsPanel
        workspaceId={ws.workspaceId}
        slug={slug}
        name={ws.workspaceName}
        memberCount={members.length}
        canManage={can(ws.role, "member:manage")}
        canDelete={can(ws.role, "workspace:delete")}
      />
    </>
  );
}
