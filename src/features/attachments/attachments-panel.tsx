"use client";

import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatDate } from "@/lib/dates";
import { MAX_ATTACHMENT_BYTES } from "@/lib/storage/rules";
import { cn } from "@/lib/utils";
import { confirmUploadAction, deleteAttachmentAction, listAttachmentsAction, requestUploadAction } from "./actions";

interface Item {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploaderId: string | null;
  uploaderName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  createdAt: string;
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Browser → storage upload with progress. Resolves when the server has responded. */
function putFile(url: string, headers: Record<string, string>, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function AttachmentsPanel({
  projectId,
  taskId,
  currentUserId,
  perms,
  compact,
}: {
  projectId: string;
  taskId?: string;
  currentUserId: string;
  perms: { upload: boolean; moderate: boolean };
  compact?: boolean;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [version, setVersion] = useState(0);
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listAttachmentsAction(projectId, taskId).then((res) => {
      if (!cancelled && res.ok) setItems(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, version]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
        continue;
      }
      const set = (pct: number) => setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, pct } : x)));
      setUploads((u) => [...u, { name: file.name, pct: 0 }]);
      try {
        const req = await requestUploadAction({ projectId, taskId: taskId ?? null, fileName: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size });
        if (!req.ok) throw new Error(req.error);
        await putFile(req.data.target.url, req.data.target.headers, file, set);
        const done = await confirmUploadAction(req.data.attachmentId);
        if (!done.ok) throw new Error(done.error);
        toast.success(`${file.name} uploaded`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`);
      } finally {
        setUploads((u) => u.filter((x) => x.name !== file.name));
        setVersion((v) => v + 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  return (
    <section aria-label="Attachments" className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn("flex items-center gap-1.5 font-medium", compact ? "text-sm" : "text-base")}>
          <Paperclip className="size-4" /> Attachments {items ? `(${items.length})` : ""}
        </h3>
        {perms.upload ? (
          <>
            <input ref={input} type="file" multiple className="sr-only" aria-label="Choose files to attach" onChange={(e) => upload(e.target.files)} />
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              <Upload /> Upload
            </Button>
          </>
        ) : null}
      </div>
      {uploads.map((u) => (
        <div key={u.name} className="grid gap-1 text-xs" aria-live="polite">
          <span className="truncate">Uploading {u.name}… {u.pct}%</span>
          <ProgressBar value={u.pct} size="sm" label={`Uploading ${u.name}`} />
        </div>
      ))}
      {items === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {items && items.length === 0 && uploads.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No files attached. {perms.upload ? `Files up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` : ""}
        </p>
      ) : null}
      <ul className="grid gap-1.5">
        {(items ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{a.fileName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {size(a.sizeBytes)} · {a.uploaderName ?? "Former member"} · {formatDate(a.createdAt.slice(0, 10), "MMM d, yyyy")}
                {!taskId && a.taskTitle ? ` · on “${a.taskTitle}”` : ""}
              </p>
            </div>
            <a href={`/api/attachments/${a.id}/download`} download aria-label={`Download ${a.fileName}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Download className="size-4" />
            </a>
            {(a.uploaderId === currentUserId && perms.upload) || perms.moderate ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${a.fileName}`}>
                    <Trash2 />
                  </Button>
                }
                title={`Delete “${a.fileName}”?`}
                description="The file is permanently removed from storage."
                onConfirm={async () => {
                  const res = await deleteAttachmentAction(a.id);
                  if (res.ok) toast.success("Attachment deleted");
                  else toast.error(res.error);
                  setVersion((v) => v + 1);
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
