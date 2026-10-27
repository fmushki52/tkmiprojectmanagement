import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { NotificationList } from "@/features/notifications/notification-list";
import { getWorkspaceCtx } from "@/server/context";
import { listNotifications } from "@/server/services/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ params }: PageProps<"/w/[slug]/notifications">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  const rows = await listNotifications(ws, { limit: 100 });
  return (
    <>
      <PageHeader title="Notifications" description="In-app notifications for this workspace. Email delivery is not enabled." />
      <NotificationList
        workspaceId={ws.workspaceId}
        items={rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt.toISOString() }))}
      />
    </>
  );
}
