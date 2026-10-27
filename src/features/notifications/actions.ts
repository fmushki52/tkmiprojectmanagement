"use server";

import { uuid } from "@/lib/validation";
import { getCtxByWorkspaceId } from "@/server/context";
import { parse, runAction } from "@/server/action";
import * as notifications from "@/server/services/notifications";

export async function markNotificationReadAction(workspaceId: string, id: string) {
  return runAction(async () => {
    await notifications.markRead(await getCtxByWorkspaceId(parse(uuid, workspaceId)), parse(uuid, id));
  });
}

export async function markAllNotificationsReadAction(workspaceId: string) {
  return runAction(async () => {
    await notifications.markAllRead(await getCtxByWorkspaceId(parse(uuid, workspaceId)));
  });
}
