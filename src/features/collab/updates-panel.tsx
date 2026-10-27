"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { History, MessageSquare, Pencil, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { HEALTH_TONE, PROJECT_STATUS_TONE, label } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import { HEALTHS, PROJECT_STATUSES, type ProjectUpdateFormValues, type ProjectUpdateInput, projectUpdateSchema } from "@/lib/validation";
import { CommentThread } from "./comment-thread";
import { editUpdateAction, publishUpdateAction, retractUpdateAction } from "./actions";

export interface UpdateItem {
  id: string;
  title: string;
  status: (typeof PROJECT_STATUSES)[number];
  health: (typeof HEALTHS)[number];
  progressSummary: string;
  completedWork: string;
  nextSteps: string;
  risksBlockers: string;
  decisions: string;
  progressSnapshot: number;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  revisions: number;
  retractedAt: string | null;
  retractedByName: string | null;
  retractReason: string | null;
}

const SECTIONS = [
  ["progressSummary", "Progress summary"],
  ["completedWork", "Completed work"],
  ["nextSteps", "Planned next steps"],
  ["risksBlockers", "Risks & blockers"],
  ["decisions", "Decisions & notes"],
] as const;

function UpdateFormDialog({ projectId, update, defaultStatus, trigger }: { projectId: string; update?: UpdateItem; defaultStatus: UpdateItem["status"]; trigger: React.ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const make = (): ProjectUpdateFormValues => ({
    title: update?.title ?? "",
    status: update?.status ?? defaultStatus,
    health: update?.health ?? "on_track",
    progressSummary: update?.progressSummary ?? "",
    completedWork: update?.completedWork ?? "",
    nextSteps: update?.nextSteps ?? "",
    risksBlockers: update?.risksBlockers ?? "",
    decisions: update?.decisions ?? "",
  });
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    reset,
    formState: { errors },
  } = useForm<ProjectUpdateFormValues, unknown, ProjectUpdateInput>({ resolver: zodResolver(projectUpdateSchema), defaultValues: make() });

  async function submit() {
    setPending(true);
    const raw = getValues();
    const res = update ? await editUpdateAction(update.id, raw) : await publishUpdateAction(projectId, raw);
    setPending(false);
    if (!res.ok) {
      for (const [f, m] of Object.entries(res.fieldErrors ?? {})) setError(f as keyof ProjectUpdateFormValues, { message: m[0] });
      toast.error(res.error);
      return;
    }
    toast.success(update ? "Update revised" : "Update published");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(make()); }}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{update ? "Revise update" : "Publish project update"}</DialogTitle>
          <DialogDescription>
            {update ? "Saving publishes a new revision; the previous version is kept in the history." : "Published updates are append-only. Later edits create revisions and removals are recorded."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="grid gap-4" noValidate>
          <Field label="Title" htmlFor="u-title" error={errors.title?.message}>
            <Input id="u-title" placeholder="Week 12 status" aria-invalid={!!errors.title} {...register("title")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Overall status" htmlFor="u-status">
              <NativeSelect id="u-status" {...register("status")}>{PROJECT_STATUSES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</NativeSelect>
            </Field>
            <Field label="Overall health" htmlFor="u-health">
              <NativeSelect id="u-health" {...register("health")}>{HEALTHS.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</NativeSelect>
            </Field>
          </div>
          {SECTIONS.map(([key, text]) => (
            <Field key={key} label={text} htmlFor={`u-${key}`} error={errors[key]?.message}>
              <Textarea id={`u-${key}`} rows={3} {...register(key)} />
            </Field>
          ))}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : update ? "Publish revision" : "Publish update"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RetractDialog({ update }: { update: UpdateItem }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="xs"><Undo2 /> Retract</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retract “{update.title}”?</DialogTitle>
          <DialogDescription>The update stays in the record but is marked as withdrawn with your name and reason. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="retract-reason">
          <Textarea id="retract-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={pending || !reason.trim()}
            onClick={async () => {
              const res = await run(() => retractUpdateAction(update.id, reason), { success: "Update retracted" });
              if (res.ok) setOpen(false);
            }}
          >
            Retract update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UpdatesPanel({
  projectId,
  updates,
  projectStatus,
  people,
  currentUserId,
  perms,
}: {
  projectId: string;
  updates: UpdateItem[];
  projectStatus: UpdateItem["status"];
  people: { id: string; name: string }[];
  currentUserId: string;
  perms: { publish: boolean; moderate: boolean; comment: boolean };
}) {
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  return (
    <div id="updates" className="grid gap-4">
      {perms.publish ? (
        <div className="flex justify-end">
          <UpdateFormDialog projectId={projectId} defaultStatus={projectStatus} trigger={<Button size="sm"><Plus /> Publish update</Button>} />
        </div>
      ) : null}
      {updates.length === 0 ? (
        <EmptyState icon={<History />} title="No updates published" description="Post a dated update with progress, next steps and risks to keep stakeholders informed." />
      ) : (
        <ol className="grid gap-4">
          {updates.map((u) => {
            const canModify = perms.moderate || (perms.publish && u.authorId === currentUserId);
            const retracted = !!u.retractedAt;
            return (
              <li key={u.id}>
                <Card className="gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className={`font-medium ${retracted ? "text-muted-foreground line-through" : ""}`}>{u.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {u.authorName ?? "Former member"} · <time dateTime={u.createdAt}>{formatDate(u.createdAt.slice(0, 10))}</time>
                        {u.revisions > 0 ? ` · revised ${u.revisions}×` : ""} · {u.progressSnapshot}% complete when published
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StatusBadge value={u.status} tones={PROJECT_STATUS_TONE} />
                      <StatusBadge value={u.health} tones={HEALTH_TONE} />
                    </div>
                  </div>
                  {retracted ? (
                    <p className="rounded-lg bg-muted p-2.5 text-sm">
                      <strong>Retracted</strong> by {u.retractedByName ?? "a project manager"} on {formatDate(u.retractedAt!.slice(0, 10))}: {u.retractReason}
                    </p>
                  ) : (
                    <dl className="grid gap-2 text-sm">
                      {SECTIONS.map(([key, text]) =>
                        u[key].trim() ? (
                          <div key={key}>
                            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{text}</dt>
                            <dd className="whitespace-pre-wrap">{u[key]}</dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  )}
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="xs" aria-expanded={commentsFor === u.id} onClick={() => setCommentsFor(commentsFor === u.id ? null : u.id)}>
                      <MessageSquare /> Discussion
                    </Button>
                    {canModify && !retracted ? (
                      <>
                        <UpdateFormDialog projectId={projectId} update={u} defaultStatus={projectStatus} trigger={<Button variant="ghost" size="xs"><Pencil /> Revise</Button>} />
                        <RetractDialog update={u} />
                      </>
                    ) : null}
                  </div>
                  {commentsFor === u.id ? (
                    <div className="border-t pt-3">
                      <CommentThread target={{ updateId: u.id }} people={people.map((p) => ({ userId: p.id, name: p.name }))} currentUserId={currentUserId} canComment={perms.comment} canModerate={perms.moderate} />
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
