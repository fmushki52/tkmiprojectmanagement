import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { AppError } from "@/lib/errors";
import { MAX_ATTACHMENT_BYTES } from "@/lib/storage/rules";
import { confirmUpload, deleteAttachment, getDownloadable, listAttachments, purgePendingAttachments, requestUpload } from "@/server/services/attachments";
import { createProject, deleteProject } from "@/server/services/projects";
import { createTask, deleteTask } from "@/server/services/tasks";
import { deleteWorkspace } from "@/server/services/workspaces";
import { projectInput, seedUser, seedWorkspace, taskInput, useTestDb, type TestDb } from "../helpers/db";

/** In-memory object store standing in for S3 (the real drivers are covered by unit tests). */
const store = vi.hoisted(() => ({ objects: new Map<string, number>() }));
vi.mock("@/lib/storage", () => ({
  getStorage: () => ({
    kind: "s3",
    createUploadTarget: async ({ key }: { key: string }) => ({ url: `https://bucket.test/${key}`, method: "PUT", headers: {} }),
    head: async (key: string) => (store.objects.has(key) ? { sizeBytes: store.objects.get(key)! } : null),
    remove: async (key: string) => void store.objects.delete(key),
    createDownloadUrl: async (key: string) => `https://bucket.test/${key}?signed`,
  }),
  isLocalStorage: () => false,
}));

let db: TestDb;
beforeAll(async () => {
  db = await useTestDb();
});
beforeEach(() => store.objects.clear());

const rejects = (p: Promise<unknown>) => p.then(() => null, (e) => e as AppError);
const file = (over: Partial<Parameters<typeof requestUpload>[1]> & { projectId: string }) => ({ fileName: "spec.pdf", contentType: "application/pdf", sizeBytes: 2048, ...over });

async function upload(ctx: Parameters<typeof requestUpload>[0], projectId: string, over: Partial<Parameters<typeof requestUpload>[1]> = {}) {
  const req = await requestUpload(ctx, file({ projectId, ...over }));
  const key = (await db.select().from(schema.attachments).where(eq(schema.attachments.id, req.attachmentId)))[0].storageKey;
  store.objects.set(key, over.sizeBytes ?? 2048); // the browser PUT to the bucket
  return { ...req, key, confirmed: await confirmUpload(ctx, req.attachmentId) };
}

describe("attachments", () => {
  it("is two-phase: pending files are invisible until the stored object is verified", async () => {
    const w = await seedWorkspace(db, "Files", ["owner", "contributor", "viewer"]);
    const p = await createProject(w.owner, projectInput());
    const req = await requestUpload(w.contributor, file({ projectId: p.id }));
    expect(req.target.url).toContain(`workspaces/${w.workspace.id}/projects/${p.id}/`);

    expect(await listAttachments(w.owner, { projectId: p.id })).toHaveLength(0);
    expect(await rejects(getDownloadable(w.owner, req.attachmentId))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejects(confirmUpload(w.contributor, req.attachmentId))).toMatchObject({ code: "RULE" }); // nothing stored yet

    const [row] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, req.attachmentId));
    store.objects.set(row.storageKey, 2048);
    expect(await rejects(confirmUpload(w.owner, req.attachmentId))).toMatchObject({ code: "FORBIDDEN" }); // only the uploader confirms
    const done = await confirmUpload(w.contributor, req.attachmentId);
    expect(done.uploadedAt).toBeInstanceOf(Date);
    expect(await confirmUpload(w.contributor, req.attachmentId)).toMatchObject({ id: req.attachmentId }); // idempotent

    const listed = await listAttachments(w.viewer, { projectId: p.id }); // viewers can read
    expect(listed.map((l) => l.attachment.fileName)).toEqual(["spec.pdf"]);
    expect((await getDownloadable(w.viewer, req.attachmentId)).storageKey).toBe(row.storageKey);
  });

  it("enforces roles on upload and rejects bad files", async () => {
    const w = await seedWorkspace(db, "Rules", ["owner", "viewer"]);
    const p = await createProject(w.owner, projectInput());
    expect(await rejects(requestUpload(w.viewer, file({ projectId: p.id })))).toMatchObject({ code: "FORBIDDEN" });
    expect(await rejects(requestUpload(w.owner, file({ projectId: p.id, sizeBytes: MAX_ATTACHMENT_BYTES + 1 })))).toMatchObject({ code: "RULE" });
    expect(await rejects(requestUpload(w.owner, file({ projectId: p.id, fileName: "x.html" })))).toMatchObject({ code: "RULE" });
    expect(await rejects(requestUpload(w.owner, file({ projectId: p.id, sizeBytes: 0 })))).toMatchObject({ code: "RULE" });
    const traversal = await requestUpload(w.owner, file({ projectId: p.id, fileName: "../../../etc/passwd" }));
    const [row] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, traversal.attachmentId));
    expect(row.fileName).toBe("passwd");
    expect(row.storageKey).not.toContain("..");
    // A hostile content type is replaced by a generic one.
    const odd = await requestUpload(w.owner, file({ projectId: p.id, contentType: "text/html; <script>" }));
    expect((await db.select().from(schema.attachments).where(eq(schema.attachments.id, odd.attachmentId)))[0].contentType).toBe("application/octet-stream");
  });

  it("discards a file whose stored size differs from what was declared", async () => {
    const w = await seedWorkspace(db, "Size", ["owner"]);
    const p = await createProject(w.owner, projectInput());
    const req = await requestUpload(w.owner, file({ projectId: p.id, sizeBytes: 100 }));
    const [row] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, req.attachmentId));
    store.objects.set(row.storageKey, 99999);
    expect(await rejects(confirmUpload(w.owner, req.attachmentId))).toMatchObject({ code: "RULE" });
    expect(store.objects.has(row.storageKey)).toBe(false);
    expect(await db.select().from(schema.attachments).where(eq(schema.attachments.id, req.attachmentId))).toHaveLength(0);
  });

  it("is isolated between workspaces", async () => {
    const a = await seedWorkspace(db, "Alpha", ["owner"]);
    const b = await seedWorkspace(db, "Bravo", ["owner"]);
    const pa = await createProject(a.owner, projectInput());
    const pb = await createProject(b.owner, projectInput());
    const ta = await createTask(a.owner, pa.id, taskInput());
    const up = await upload(a.owner, pa.id);

    expect(await rejects(requestUpload(b.owner, file({ projectId: pa.id })))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejects(listAttachments(b.owner, { projectId: pa.id }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejects(getDownloadable(b.owner, up.attachmentId))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejects(confirmUpload(b.owner, up.attachmentId))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejects(deleteAttachment(b.owner, up.attachmentId))).toMatchObject({ code: "NOT_FOUND" });
    // A task from another project/workspace cannot be used as an attachment target.
    expect(await rejects(requestUpload(b.owner, file({ projectId: pb.id, taskId: ta.id })))).toMatchObject({ code: "NOT_FOUND" });
    expect(store.objects.has(up.key)).toBe(true);
  });

  it("lets uploaders and moderators delete, and removes the stored object", async () => {
    const w = await seedWorkspace(db, "Delete", ["owner", "project_manager", "contributor"]);
    const other = await seedUser(db, "Other");
    await db.insert(schema.workspaceMembers).values({ workspaceId: w.workspace.id, userId: other.id, role: "contributor" });
    const otherCtx = { userId: other.id, workspaceId: w.workspace.id, role: "contributor" as const };
    const p = await createProject(w.owner, projectInput());

    const mine = await upload(w.contributor, p.id);
    expect(await rejects(deleteAttachment(otherCtx, mine.attachmentId))).toMatchObject({ code: "FORBIDDEN" });
    await deleteAttachment(w.contributor, mine.attachmentId);
    expect(store.objects.has(mine.key)).toBe(false);

    const theirs = await upload(w.contributor, p.id);
    await deleteAttachment(w.project_manager, theirs.attachmentId); // moderator
    expect(store.objects.size).toBe(0);
    expect(await listAttachments(w.owner, { projectId: p.id })).toHaveLength(0);
  });

  it("removes stored objects when a task, project or workspace is deleted", async () => {
    const w = await seedWorkspace(db, "Cascade", ["owner"]);
    const p1 = await createProject(w.owner, projectInput({ title: "P1" }));
    const t = await createTask(w.owner, p1.id, taskInput());
    const sub = await createTask(w.owner, p1.id, taskInput({ title: "sub", parentTaskId: t.id }));
    const onTask = await upload(w.owner, p1.id, { taskId: t.id });
    const onSub = await upload(w.owner, p1.id, { taskId: sub.id });
    const onProject = await upload(w.owner, p1.id);
    await deleteTask(w.owner, t.id);
    expect(store.objects.has(onTask.key)).toBe(false);
    expect(store.objects.has(onSub.key)).toBe(false);
    expect(store.objects.has(onProject.key)).toBe(true);
    await deleteProject(w.owner, p1.id);
    expect(store.objects.has(onProject.key)).toBe(false);

    const p2 = await createProject(w.owner, projectInput({ title: "P2" }));
    const last = await upload(w.owner, p2.id);
    await deleteWorkspace(w.owner);
    expect(store.objects.has(last.key)).toBe(false);
  });

  it("purges abandoned pending uploads after a day, but keeps recent and confirmed ones", async () => {
    const w = await seedWorkspace(db, "Purge", ["owner"]);
    const p = await createProject(w.owner, projectInput());
    const stale = await requestUpload(w.owner, file({ projectId: p.id }));
    const fresh = await requestUpload(w.owner, file({ projectId: p.id, fileName: "new.pdf" }));
    const kept = await upload(w.owner, p.id, { fileName: "kept.pdf" });
    const [row] = await db.select().from(schema.attachments).where(eq(schema.attachments.id, stale.attachmentId));
    store.objects.set(row.storageKey, 5);
    await db.update(schema.attachments).set({ createdAt: new Date(Date.now() - 2 * 86400000) }).where(eq(schema.attachments.id, stale.attachmentId));
    expect(await purgePendingAttachments()).toBe(1);
    expect(store.objects.has(row.storageKey)).toBe(false);
    const ids = (await db.select({ id: schema.attachments.id }).from(schema.attachments)).map((r) => r.id);
    expect(ids).toContain(fresh.attachmentId);
    expect(ids).toContain(kept.attachmentId);
    expect(ids).not.toContain(stale.attachmentId);
  });
});
