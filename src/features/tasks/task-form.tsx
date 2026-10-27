"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { label } from "@/lib/format";
import { PRIORITIES, TASK_STATUSES, type TaskFormValues, type TaskInput, taskSchema } from "@/lib/validation";
import { createTaskAction, updateTaskAction } from "./actions";
import type { Option, TaskItem } from "./types";

export interface TaskFormProps {
  projectId: string;
  task?: TaskItem;
  /** Current labels and dependency ids (loaded with the detail). */
  labels?: string[];
  dependsOn?: string[];
  milestones: Option[];
  people: Option[];
  /** Other tasks in the project, used for parent and dependency pickers. */
  otherTasks: { id: string; title: string; parentTaskId: string | null }[];
  defaultStatus?: TaskItem["status"];
  defaultMilestoneId?: string | null;
  defaultParentId?: string | null;
  readOnly?: boolean;
  onSaved: () => void;
}

export function TaskForm({ projectId, task, labels = [], dependsOn = [], milestones, people, otherTasks, defaultStatus, defaultMilestoneId, defaultParentId, readOnly, onSaved }: TaskFormProps) {
  const [pending, setPending] = useState(false);
  const form = useForm<TaskFormValues, unknown, TaskInput>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: task?.status ?? defaultStatus ?? "todo",
      priority: task?.priority ?? "medium",
      assigneeId: task?.assigneeId ?? "",
      milestoneId: task?.milestoneId ?? defaultMilestoneId ?? "",
      parentTaskId: task?.parentTaskId ?? defaultParentId ?? "",
      startDate: task?.startDate ?? "",
      dueDate: task?.dueDate ?? "",
      estimateHours: task?.estimateHours ?? "",
      actualHours: task?.actualHours ?? "",
      progress: task?.progress === null || task?.progress === undefined ? "" : String(task.progress),
      labels: labels.join(", "),
      dependsOn,
    },
  });
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    control,
    formState: { errors },
  } = form;
  const deps = useWatch({ control, name: "dependsOn" }) ?? [];
  const parentId = useWatch({ control, name: "parentTaskId" });

  async function submit() {
    setPending(true);
    const raw = getValues();
    const res = task ? await updateTaskAction(task.id, raw) : await createTaskAction(projectId, raw);
    setPending(false);
    if (!res.ok) {
      for (const [field, msgs] of Object.entries(res.fieldErrors ?? {})) setError(field as keyof TaskFormValues, { message: msgs[0] });
      toast.error(res.error);
      return;
    }
    toast.success(task ? "Task updated" : "Task created");
    onSaved();
  }

  const dependencyCandidates = otherTasks.filter((t) => t.id !== task?.id);
  const parentCandidates = otherTasks.filter((t) => t.id !== task?.id && !t.parentTaskId);

  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-4" noValidate>
      <fieldset disabled={readOnly} className="grid gap-4">
        <Field label="Title" htmlFor="t-title" error={errors.title?.message}>
          <Input id="t-title" aria-invalid={!!errors.title} {...register("title")} />
        </Field>
        <Field label="Description" htmlFor="t-desc" error={errors.description?.message}>
          <Textarea id="t-desc" rows={3} {...register("description")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="t-status" error={errors.status?.message}>
            <NativeSelect id="t-status" {...register("status")}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Priority" htmlFor="t-priority">
            <NativeSelect id="t-priority" {...register("priority")}>
              {PRIORITIES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Assignee" htmlFor="t-assignee" error={errors.assigneeId?.message}>
            <NativeSelect id="t-assignee" {...register("assigneeId")}>
              <option value="">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Milestone" htmlFor="t-milestone" error={errors.milestoneId?.message} hint={parentId ? "Subtasks follow their parent’s milestone." : undefined}>
            <NativeSelect id="t-milestone" disabled={!!parentId} {...register("milestoneId")}>
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Start date" htmlFor="t-start" error={errors.startDate?.message}>
            <Input id="t-start" type="date" {...register("startDate")} />
          </Field>
          <Field label="Due date" htmlFor="t-due" error={errors.dueDate?.message}>
            <Input id="t-due" type="date" aria-invalid={!!errors.dueDate} {...register("dueDate")} />
          </Field>
          <Field label="Estimated effort (hours)" htmlFor="t-est" error={errors.estimateHours?.message}>
            <Input id="t-est" type="number" min="0" step="0.25" inputMode="decimal" {...register("estimateHours")} />
          </Field>
          <Field label="Actual effort (hours)" htmlFor="t-act" error={errors.actualHours?.message}>
            <Input id="t-act" type="number" min="0" step="0.25" inputMode="decimal" {...register("actualHours")} />
          </Field>
          <Field label="Progress override (%)" htmlFor="t-progress" error={errors.progress?.message} hint="Optional. Leave blank to use the status default. Done is always 100%.">
            <Input id="t-progress" type="number" min="0" max="100" step="1" inputMode="numeric" {...register("progress")} />
          </Field>
          <Field label="Parent task" htmlFor="t-parent" error={errors.parentTaskId?.message}>
            <NativeSelect id="t-parent" {...register("parentTaskId")}>
              <option value="">None (top-level task)</option>
              {parentCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Labels" htmlFor="t-labels" hint="Comma separated." error={errors.labels?.message}>
          <Input id="t-labels" placeholder="bug, design" {...register("labels")} />
        </Field>
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">Depends on</legend>
          <p className="text-xs text-muted-foreground">This task can only be completed after the selected tasks are done.</p>
          {dependencyCandidates.length === 0 ? <p className="text-sm text-muted-foreground">No other tasks in this project.</p> : null}
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2">
            {dependencyCandidates.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={deps.includes(t.id)}
                  onChange={(e) => setValue("dependsOn", e.target.checked ? [...deps, t.id] : deps.filter((d) => d !== t.id), { shouldDirty: true })}
                />
                <span className="truncate">{t.title}</span>
              </label>
            ))}
          </div>
          {errors.dependsOn ? <p role="alert" className="text-xs font-medium text-destructive">{String(errors.dependsOn.message ?? "Invalid dependencies")}</p> : null}
        </fieldset>
      </fieldset>
      {!readOnly ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : task ? "Save changes" : "Create task"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
