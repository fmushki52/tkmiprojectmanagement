"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_COLORS, label } from "@/lib/format";
import { HEALTHS, PRIORITIES, PROJECT_STATUSES, type ProjectFormValues, type ProjectInput, projectSchema } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { createProjectAction, updateProjectAction } from "./actions";

export interface PersonOption {
  userId: string;
  name: string;
}

export interface EditableProject {
  id: string;
  title: string;
  description: string;
  scope: string;
  startDate: string;
  plannedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  ownerId: string | null;
  status: (typeof PROJECT_STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
  health: (typeof HEALTHS)[number] | null;
  color: string;
  tags: string[];
  progressWeighting: "equal" | "effort";
  memberIds: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

function defaults(p?: EditableProject): ProjectFormValues {
  return p
    ? {
        title: p.title,
        description: p.description,
        scope: p.scope,
        startDate: p.startDate,
        plannedEndDate: p.plannedEndDate,
        actualStartDate: p.actualStartDate ?? "",
        actualEndDate: p.actualEndDate ?? "",
        ownerId: p.ownerId ?? "",
        status: p.status,
        priority: p.priority,
        health: p.health ?? "",
        color: p.color,
        tags: p.tags.join(", "),
        progressWeighting: p.progressWeighting,
        memberIds: p.memberIds,
      }
    : {
        title: "",
        description: "",
        scope: "",
        startDate: today(),
        plannedEndDate: "",
        actualStartDate: "",
        actualEndDate: "",
        ownerId: "",
        status: "planning",
        priority: "medium",
        health: "",
        color: PROJECT_COLORS[0],
        tags: "",
        progressWeighting: "equal",
        memberIds: [],
      };
}

export function ProjectFormDialog({
  workspaceId,
  slug,
  people,
  project,
  trigger,
}: {
  workspaceId: string;
  slug: string;
  people: PersonOption[];
  project?: EditableProject;
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const form = useForm<ProjectFormValues, unknown, ProjectInput>({ resolver: zodResolver(projectSchema), defaultValues: defaults(project) });
  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    control,
    reset,
    formState: { errors },
  } = form;
  const color = useWatch({ control, name: "color" });
  const memberIds = useWatch({ control, name: "memberIds" }) ?? [];
  const editing = !!project;

  async function submit() {
    setPending(true);
    // Send the raw form values; the server parses and validates them again.
    const raw = getValues();
    const res = project ? await updateProjectAction(project.id, raw) : await createProjectAction(workspaceId, raw);
    setPending(false);
    if (!res.ok) {
      for (const [field, msgs] of Object.entries(res.fieldErrors ?? {})) setError(field as keyof ProjectFormValues, { message: msgs[0] });
      toast.error(res.error);
      return;
    }
    toast.success(editing ? "Project updated" : "Project created");
    setOpen(false);
    if (!editing && res.data && "id" in res.data) router.push(`/w/${slug}/projects/${res.data.id}`);
    else router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset(defaults(project));
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>{editing ? "Update the project's details and schedule." : "Set up the basics. You can add milestones and tasks next."}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(submit, (errs) => toast.error(`Please fix: ${Object.entries(errs).map(([k, v]) => `${k} (${v?.message ?? "invalid"})`).join(", ")}`))}
          className="grid gap-4"
          noValidate
        >
          <Field label="Title" htmlFor="p-title" error={errors.title?.message}>
            <Input id="p-title" aria-invalid={!!errors.title} {...register("title")} />
          </Field>
          <Field label="Short description" htmlFor="p-desc" error={errors.description?.message} hint="Up to 500 characters.">
            <Input id="p-desc" {...register("description")} />
          </Field>
          <Field label="Scope" htmlFor="p-scope" error={errors.scope?.message} hint="What is in and out of scope, goals, deliverables.">
            <Textarea id="p-scope" rows={4} {...register("scope")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="p-start" error={errors.startDate?.message}>
              <Input id="p-start" type="date" aria-invalid={!!errors.startDate} {...register("startDate")} />
            </Field>
            <Field label="Planned end date" htmlFor="p-end" error={errors.plannedEndDate?.message}>
              <Input id="p-end" type="date" aria-invalid={!!errors.plannedEndDate} {...register("plannedEndDate")} />
            </Field>
            <Field label="Actual start (optional)" htmlFor="p-astart" error={errors.actualStartDate?.message}>
              <Input id="p-astart" type="date" {...register("actualStartDate")} />
            </Field>
            <Field label="Actual completion (optional)" htmlFor="p-aend" error={errors.actualEndDate?.message}>
              <Input id="p-aend" type="date" {...register("actualEndDate")} />
            </Field>
            <Field label="Status" htmlFor="p-status">
              <NativeSelect id="p-status" {...register("status")}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Priority" htmlFor="p-priority">
              <NativeSelect id="p-priority" {...register("priority")}>
                {PRIORITIES.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Owner" htmlFor="p-owner" hint={editing ? undefined : "Defaults to you."}>
              <NativeSelect id="p-owner" {...register("ownerId")}>
                <option value="">{editing ? "No owner" : "Me"}</option>
                {people.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Health" htmlFor="p-health" hint="Automatic uses documented rules; choose a value to override.">
              <NativeSelect id="p-health" {...register("health")}>
                <option value="">Automatic</option>
                {HEALTHS.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Progress weighting" htmlFor="p-weight" hint="Effort uses task estimates (hours) as weights.">
              <NativeSelect id="p-weight" {...register("progressWeighting")}>
                <option value="equal">Equal</option>
                <option value="effort">By estimated effort</option>
              </NativeSelect>
            </Field>
            <Field label="Tags" htmlFor="p-tags" hint="Comma separated.">
              <Input id="p-tags" placeholder="web, q3, design" {...register("tags")} />
            </Field>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Color</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Project color">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setValue("color", c)}
                  className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", color === c && "ring-2 ring-foreground")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Team members</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {people.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(m.userId)}
                    onChange={(e) => setValue("memberIds", e.target.checked ? [...memberIds, m.userId] : memberIds.filter((id) => id !== m.userId))}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save changes" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
