"use client";

import { Bell, Check } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { label } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export function NotificationList({ workspaceId, items }: { workspaceId: string; items: NotificationItem[] }) {
  const { run, pending } = useAction();
  const unread = items.filter((i) => !i.read).length;
  if (items.length === 0) {
    return <EmptyState icon={<Bell />} title="You're all caught up" description="Assignments, mentions, comments, deadlines and milestone completions will show up here." />;
  }
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">{unread} unread</p>
        <Button variant="outline" size="sm" disabled={pending || unread === 0} onClick={() => run(() => markAllNotificationsReadAction(workspaceId), { success: "All marked as read" })}>
          <Check /> Mark all as read
        </Button>
      </div>
      <ul className="divide-y rounded-xl border">
        {items.map((n) => (
          <li key={n.id} className={cn("flex items-start gap-3 p-3", !n.read && "bg-primary/5")}>
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-label={n.read ? undefined : "Unread"} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {n.link ? (
                  <Link href={n.link} className="hover:underline" onClick={() => !n.read && void markNotificationReadAction(workspaceId, n.id)}>{n.title}</Link>
                ) : n.title}
              </p>
              {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
              <p className="mt-0.5 text-xs text-muted-foreground">{label(n.type)} · <time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></p>
            </div>
            {!n.read ? (
              <Button variant="ghost" size="xs" onClick={() => run(() => markNotificationReadAction(workspaceId, n.id))}>Mark read</Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
