import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getStorage } from "@/lib/storage";

const { attachments, tasks } = schema;

/** WHERE clauses selecting the attachments that a cascading delete will remove. */
export const attachmentKeysWhere = {
  project: (workspaceId: string, projectId: string) => and(eq(attachments.workspaceId, workspaceId), eq(attachments.projectId, projectId))!,
  /** The task and its subtasks (deleting a parent cascades to its subtasks). */
  task: (workspaceId: string, taskId: string) =>
    and(
      eq(attachments.workspaceId, workspaceId),
      or(eq(attachments.taskId, taskId), inArray(attachments.taskId, getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.parentTaskId, taskId)))),
    )!,
  workspace: (workspaceId: string) => eq(attachments.workspaceId, workspaceId),
};

/** Keys of every stored file matching `where`; call BEFORE a cascading delete so the objects can be removed afterwards. */
export async function collectStorageKeys(where: SQL): Promise<string[]> {
  const rows = await getDb().select({ key: attachments.storageKey }).from(attachments).where(where);
  return rows.map((r) => r.key);
}

/** Best-effort object cleanup after a cascading delete; failures are logged (the DB rows are already gone). */
export async function removeObjects(keys: string[]) {
  if (!keys.length) return;
  const storage = getStorage();
  for (const key of keys) {
    try {
      await storage.remove(key);
    } catch (e) {
      console.error("[storage] failed to remove object", key, e);
    }
  }
}
