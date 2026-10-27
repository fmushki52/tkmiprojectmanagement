"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Flag, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { CommentThread } from "@/features/collab/comment-thread";
import { daysBetween, formatDate, todayISO } from "@/lib/dates";
import { MILESTONE_STATUS_TONE, PRIORITY_TONE } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import { deleteMilestoneAction, reorderMilestonesAction } from "./actions";
import { type EditableMilestone, MilestoneFormDialog } from "./milestone-form";

export interface MilestoneItem extends EditableMilestone {
  ownerName: string | null;
  percent: number;
  source: "calculated" | "manual";
  done: number;
  total: number;
}

export function MilestonesPanel({
  projectId,
  milestones,
  people,
  currentUserId,
  perms,
}: {
  projectId: string;
  milestones: MilestoneItem[];
  people: { id: string; name: string }[];
  currentUserId: string;
  perms: { write: boolean; comment: boolean; moderate: boolean };
}) {
  const { run } = useAction();
  const [notesOpen, setNotesOpen] = useState<string | null>(null);
  const today = todayISO();

  async function move(index: number, dir: -1 | 1) {
    const ids = milestones.map((m) => m.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    await run(() => reorderMilestonesAction(projectId, ids));
  }

  return (
    <div id="milestones" className="grid gap-4">
      {perms.write ? (
        <div className="flex justify-end">
          <MilestoneFormDialog projectId={projectId} people={people} trigger={<Button size="sm"><Plus /> Add milestone</Button>} />
        </div>
      ) : null}
      {milestones.length === 0 ? (
        <EmptyState icon={<Flag />} title="No milestones yet" description="Milestones group tasks into deliverables with due dates. Their completion is calculated from the tasks inside." />
      ) : (
        <ol className="grid gap-3">
          {milestones.map((m, i) => {
            const overdue = m.status !== "completed" && m.dueDate < today;
            return (
              <li key={m.id}>
                <Card className={`gap-3 p-4 ${overdue ? "border-destructive/50" : ""}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{m.title}</h3>
                        <StatusBadge value={m.status} tones={MILESTONE_STATUS_TONE} />
                        <StatusBadge value={m.priority} tones={PRIORITY_TONE} />
                        {overdue ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950 dark:text-red-200">
                            <AlertTriangle className="size-3" /> Overdue by {daysBetween(m.dueDate, today)}d
                          </span>
                        ) : null}
                      </div>
                      {m.description ? <p className="mt-1 text-sm text-muted-foreground">{m.description}</p> : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Due {formatDate(m.dueDate)}
                        {m.actualDate ? ` · Completed ${formatDate(m.actualDate)}` : ""} · {m.ownerName ? `Owner ${m.ownerName}` : "No owner"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Show notes for ${m.title}`} aria-expanded={notesOpen === m.id} onClick={() => setNotesOpen(notesOpen === m.id ? null : m.id)}>
                        <MessageSquare />
                      </Button>
                      {perms.write ? (
                        <>
                          <Button variant="ghost" size="icon-sm" aria-label={`Move ${m.title} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                          <Button variant="ghost" size="icon-sm" aria-label={`Move ${m.title} down`} disabled={i === milestones.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                          <MilestoneFormDialog projectId={projectId} milestone={m} people={people} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${m.title}`}><Pencil /></Button>} />
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="icon-sm" aria-label={`Delete ${m.title}`}><Trash2 /></Button>}
                            title={`Delete “${m.title}”?`}
                            description="The milestone is removed. Its tasks are kept but become unassigned, which changes project progress."
                            onConfirm={() => run(() => deleteMilestoneAction(m.id), { success: "Milestone deleted" })}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {m.source === "manual" ? (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200">Manual progress</span>
                        ) : (
                          `${m.done}/${m.total} tasks done · calculated`
                        )}
                      </span>
                      <span className="font-semibold">{m.percent}%</span>
                    </div>
                    <ProgressBar value={m.percent} label={`${m.title} progress`} color={m.percent >= 100 ? "#10b981" : undefined} />
                  </div>
                  {notesOpen === m.id ? (
                    <div className="border-t pt-3">
                      <CommentThread target={{ milestoneId: m.id }} people={people.map((p) => ({ userId: p.id, name: p.name }))} currentUserId={currentUserId} canComment={perms.comment} canModerate={perms.moderate} />
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
