import { AppShell } from "@/components/layout/app-shell";
import { can } from "@/lib/permissions";
import { getWorkspaceCtx } from "@/server/context";
import { syncDeadlineNotifications, unreadCount } from "@/server/services/notifications";
import { listUserWorkspaces } from "@/server/services/workspaces";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  // Lazily refresh "due soon"/"overdue" notifications (the daily cron does the same for everyone).
  await syncDeadlineNotifications(ws.workspaceId).catch((e) => console.error("[deadlines] sync failed", e));
  const [workspaces, unread] = await Promise.all([listUserWorkspaces(ws.user.id), unreadCount(ws)]);
  return (
    <AppShell slug={slug} workspaceName={ws.workspaceName} workspaces={workspaces} user={{ name: ws.user.name, email: ws.user.email }} unread={unread} canManageUsers={can(ws.role, "member:manage")}>
      {children}
    </AppShell>
  );
}
