"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { TASK_STATUS_TONE } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import { AttachmentsPanel } from "@/features/attachments/attachments-panel";
import { CommentThread } from "@/features/collab/comment-thread";
import { deleteTaskAction, loadTaskDetailAction } from "./actions";
import { TaskForm } from "./task-form";
import type { Option, TaskItem } from "./types";

interface Loaded {
  labels: string[];
  dependsOn: { id: string; title: string; status: string }[];
  subtasks: { id: string; title: string; status: string }[];
}

export function TaskDetailSheet({
  task,
  onClose,
  projectId,
  milestones,
  people,
  otherTasks,
  currentUserId,
  perms,
  onOpenTask,
}: {
  task: TaskItem | null;
  onClose: () => void;
  projectId: string;
  milestones: Option[];
  people: Option[];
  otherTasks: { id: string; title: string; parentTaskId: string | null }[];
  currentUserId: string;
  perms: { update: boolean; create: boolean; delete: boolean; comment: boolean; moderate: boolean; attach: boolean };
  onOpenTask: (id: string) => void;
}) {
  const { run } = useAction();
  const [loaded, setLoaded] = useState<{ id: string; data: Loaded } | null>(null);
  const [addingSub, setAddingSub] = useState(false);

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    loadTaskDetailAction(task.id).then((res) => {
      if (!cancelled && res.ok) setLoaded({ id: task.id, data: res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [task]);

  const open = (id: string) => {
    setAddingSub(false);
    onOpenTask(id);
  };
  const data = task && loaded?.id === task.id ? loaded.data : null;

  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {task ? (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8">{task.title}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <StatusBadge value={task.status} tones={TASK_STATUS_TONE} />
                {task.milestoneTitle ? <span>in {task.milestoneTitle}</span> : null}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 px-4 pb-6">
              {data ? (
                <TaskForm
                  key={`${task.id}-${task.status}-${task.title}`}
                  projectId={projectId}
                  task={task}
                  labels={data.labels}
                  dependsOn={data.dependsOn.map((d) => d.id)}
                  milestones={milestones}
                  people={people}
                  otherTasks={otherTasks}
                  readOnly={!perms.update}
                  onSaved={onClose}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}

              {data && !task.parentTaskId ? (
                <section aria-label="Subtasks" className="grid gap-2">
                  <h3 className="text-sm font-medium">Subtasks ({data.subtasks.length})</h3>
                  <ul className="grid gap-1">
                    {data.subtasks.map((s) => (
                      <li key={s.id}>
                        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => open(s.id)}>
                          <StatusBadge value={s.status} tones={TASK_STATUS_TONE} />
                          <span className="truncate">{s.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {perms.create ? (
                    addingSub ? (
                      <div className="rounded-lg border p-3">
                        <TaskForm
                          projectId={projectId}
                          milestones={milestones}
                          people={people}
                          otherTasks={otherTasks}
                          defaultParentId={task.id}
                          onSaved={() => {
                            setAddingSub(false);
                            loadTaskDetailAction(task.id).then((res) => res.ok && setLoaded({ id: task.id, data: res.data }));
                          }}
                        />
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-fit" onClick={() => setAddingSub(true)}>
                        Add subtask
                      </Button>
                    )
                  ) : null}
                </section>
              ) : null}

              {data && data.dependsOn.length > 0 ? (
                <section aria-label="Dependencies" className="grid gap-1">
                  <h3 className="text-sm font-medium">Waiting on</h3>
                  {data.dependsOn.map((d) => (
                    <button key={d.id} type="button" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => open(d.id)}>
                      <StatusBadge value={d.status} tones={TASK_STATUS_TONE} />
                      <span className="truncate">{d.title}</span>
                    </button>
                  ))}
                </section>
              ) : null}

              <AttachmentsPanel projectId={projectId} taskId={task.id} currentUserId={currentUserId} perms={{ upload: perms.attach, moderate: perms.moderate }} compact />

              <CommentThread target={{ taskId: task.id }} people={people.map((p) => ({ userId: p.id, name: p.name }))} currentUserId={currentUserId} canComment={perms.comment} canModerate={perms.moderate} />

              {perms.delete ? (
                <div className="border-t pt-4">
                  <ConfirmDialog
                    trigger={
                      <Button variant="destructive" size="sm">
                        <Trash2 /> Delete task
                      </Button>
                    }
                    title="Delete this task?"
                    description="This permanently deletes the task, its subtasks and comments. Milestone and project progress will be recalculated."
                    onConfirm={async () => {
                      const res = await run(() => deleteTaskAction(task.id), { success: "Task deleted" });
                      if (res.ok) onClose();
                    }}
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
