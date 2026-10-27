"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { label } from "@/lib/format";
import { MILESTONE_STATUSES, type MilestoneFormValues, type MilestoneInput, PRIORITIES, milestoneSchema } from "@/lib/validation";
import { createMilestoneAction, updateMilestoneAction } from "./actions";

export interface EditableMilestone {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  actualDate: string | null;
  ownerId: string | null;
  status: (typeof MILESTONE_STATUSES)[number];
  priority: (typeof PRIORITIES)[number];
  progressMode: "calculated" | "manual";
  manualProgress: number | null;
}

export function MilestoneFormDialog({
  projectId,
  milestone,
  people,
  trigger,
}: {
  projectId: string;
  milestone?: EditableMilestone;
  people: { id: string; name: string }[];
  trigger: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const make = (): MilestoneFormValues => ({
    title: milestone?.title ?? "",
    description: milestone?.description ?? "",
    dueDate: milestone?.dueDate ?? "",
    actualDate: milestone?.actualDate ?? "",
    ownerId: milestone?.ownerId ?? "",
    status: milestone?.status ?? "not_started",
    priority: milestone?.priority ?? "medium",
    progressMode: milestone?.progressMode ?? "calculated",
    manualProgress: milestone?.manualProgress === null || milestone?.manualProgress === undefined ? "" : String(milestone.manualProgress),
  });
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<MilestoneFormValues, unknown, MilestoneInput>({ resolver: zodResolver(milestoneSchema), defaultValues: make() });
  const manual = useWatch({ control, name: "progressMode" }) === "manual";

  async function submit() {
    setPending(true);
    const raw = getValues();
    const res = milestone ? await updateMilestoneAction(milestone.id, raw) : await createMilestoneAction(projectId, raw);
    setPending(false);
    if (!res.ok) {
      for (const [f, msgs] of Object.entries(res.fieldErrors ?? {})) setError(f as keyof MilestoneFormValues, { message: msgs[0] });
      toast.error(res.error);
      return;
    }
    toast.success(milestone ? "Milestone updated" : "Milestone added");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset(make());
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{milestone ? "Edit milestone" : "New milestone"}</DialogTitle>
          <DialogDescription>Milestone completion is calculated from its tasks unless you switch to manual progress.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="grid gap-4" noValidate>
          <Field label="Title" htmlFor="m-title" error={errors.title?.message}>
            <Input id="m-title" aria-invalid={!!errors.title} {...register("title")} />
          </Field>
          <Field label="Description" htmlFor="m-desc" error={errors.description?.message}>
            <Textarea id="m-desc" rows={3} {...register("description")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Planned due date" htmlFor="m-due" error={errors.dueDate?.message}>
              <Input id="m-due" type="date" aria-invalid={!!errors.dueDate} {...register("dueDate")} />
            </Field>
            <Field label="Actual completion date" htmlFor="m-actual" error={errors.actualDate?.message} hint="Set automatically when completed.">
              <Input id="m-actual" type="date" {...register("actualDate")} />
            </Field>
            <Field label="Owner" htmlFor="m-owner">
              <NativeSelect id="m-owner" {...register("ownerId")}>
                <option value="">No owner</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Priority" htmlFor="m-priority">
              <NativeSelect id="m-priority" {...register("priority")}>
                {PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}
              </NativeSelect>
            </Field>
            <Field label="Status" htmlFor="m-status" error={errors.status?.message}>
              <NativeSelect id="m-status" {...register("status")}>
                {MILESTONE_STATUSES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}
              </NativeSelect>
            </Field>
            <Field label="Progress mode" htmlFor="m-mode">
              <NativeSelect id="m-mode" {...register("progressMode")}>
                <option value="calculated">Calculated from tasks</option>
                <option value="manual">Manual percentage</option>
              </NativeSelect>
            </Field>
          </div>
          {manual ? (
            <Field label="Manual progress (%)" htmlFor="m-manual" error={errors.manualProgress?.message} hint="Shown as “manual” everywhere. Task progress is ignored for this milestone.">
              <Input id="m-manual" type="number" min="0" max="100" step="1" inputMode="numeric" {...register("manualProgress")} />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : milestone ? "Save changes" : "Add milestone"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
