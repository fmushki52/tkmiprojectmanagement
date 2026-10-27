"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { EmptyState } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, todayISO } from "@/lib/dates";
import { RISK_STATUS_TONE, SEVERITY_TONE, label } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import { LIKELIHOODS, RISK_KINDS, RISK_STATUSES, SEVERITIES, type RiskFormValues, type RiskInput, riskSchema } from "@/lib/validation";
import { createRiskAction, deleteRiskAction, updateRiskAction } from "./actions";

export interface RiskItem {
  id: string;
  kind: (typeof RISK_KINDS)[number];
  title: string;
  description: string;
  severity: (typeof SEVERITIES)[number];
  likelihood: (typeof LIKELIHOODS)[number];
  ownerId: string | null;
  ownerName: string | null;
  mitigation: string;
  status: (typeof RISK_STATUSES)[number];
  targetDate: string | null;
}

function RiskFormDialog({ projectId, risk, people, trigger }: { projectId: string; risk?: RiskItem; people: { id: string; name: string }[]; trigger: React.ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const make = (): RiskFormValues => ({
    kind: risk?.kind ?? "risk",
    title: risk?.title ?? "",
    description: risk?.description ?? "",
    severity: risk?.severity ?? "medium",
    likelihood: risk?.likelihood ?? "medium",
    ownerId: risk?.ownerId ?? "",
    mitigation: risk?.mitigation ?? "",
    status: risk?.status ?? "open",
    targetDate: risk?.targetDate ?? "",
  });
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    reset,
    formState: { errors },
  } = useForm<RiskFormValues, unknown, RiskInput>({ resolver: zodResolver(riskSchema), defaultValues: make() });

  async function submit() {
    setPending(true);
    const raw = getValues();
    const res = risk ? await updateRiskAction(risk.id, raw) : await createRiskAction(projectId, raw);
    setPending(false);
    if (!res.ok) {
      for (const [f, m] of Object.entries(res.fieldErrors ?? {})) setError(f as keyof RiskFormValues, { message: m[0] });
      toast.error(res.error);
      return;
    }
    toast.success(risk ? "Updated" : "Registered");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(make()); }}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{risk ? "Edit risk / issue" : "Register risk, issue or blocker"}</DialogTitle>
          <DialogDescription>Open critical items appear on the project dashboard and affect the project’s health.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="grid gap-4" noValidate>
          <Field label="Title" htmlFor="r-title" error={errors.title?.message}>
            <Input id="r-title" aria-invalid={!!errors.title} {...register("title")} />
          </Field>
          <Field label="Description" htmlFor="r-desc" error={errors.description?.message}>
            <Textarea id="r-desc" rows={3} {...register("description")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="r-kind"><NativeSelect id="r-kind" {...register("kind")}>{RISK_KINDS.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</NativeSelect></Field>
            <Field label="Status" htmlFor="r-status"><NativeSelect id="r-status" {...register("status")}>{RISK_STATUSES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</NativeSelect></Field>
            <Field label="Severity" htmlFor="r-sev"><NativeSelect id="r-sev" {...register("severity")}>{SEVERITIES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</NativeSelect></Field>
            <Field label="Likelihood" htmlFor="r-like"><NativeSelect id="r-like" {...register("likelihood")}>{LIKELIHOODS.map((s) => (<option key={s} value={s}>{label(s)}</option>))}</NativeSelect></Field>
            <Field label="Owner" htmlFor="r-owner">
              <NativeSelect id="r-owner" {...register("ownerId")}>
                <option value="">No owner</option>
                {people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </NativeSelect>
            </Field>
            <Field label="Target resolution date" htmlFor="r-target" error={errors.targetDate?.message}>
              <Input id="r-target" type="date" {...register("targetDate")} />
            </Field>
          </div>
          <Field label="Mitigation / resolution plan" htmlFor="r-mit" error={errors.mitigation?.message}>
            <Textarea id="r-mit" rows={3} {...register("mitigation")} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : risk ? "Save changes" : "Register"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RisksPanel({ projectId, risks, people, perms }: { projectId: string; risks: RiskItem[]; people: { id: string; name: string }[]; perms: { write: boolean; moderate: boolean } }) {
  const { run } = useAction();
  const today = todayISO();
  return (
    <div className="grid gap-4">
      {perms.write ? (
        <div className="flex justify-end">
          <RiskFormDialog projectId={projectId} people={people} trigger={<Button size="sm"><Plus /> Register</Button>} />
        </div>
      ) : null}
      {risks.length === 0 ? (
        <EmptyState icon={<ShieldAlert />} title="No risks or blockers registered" description="Track risks, issues and blockers with an owner and a mitigation plan." />
      ) : (
        <ul className="grid gap-3">
          {risks.map((r) => {
            const open = r.status === "open" || r.status === "mitigating";
            const late = open && r.targetDate && r.targetDate < today;
            return (
              <li key={r.id}>
                <Card className={`gap-2 p-4 ${open && r.severity === "critical" ? "border-destructive/50" : ""}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{r.title}</h3>
                        <StatusBadge value={r.kind} tones={{ risk: "violet", issue: "orange", blocker: "red" }} />
                        <StatusBadge value={r.severity} tones={SEVERITY_TONE} text={`${label(r.severity)} severity`} />
                        <StatusBadge value={r.status} tones={RISK_STATUS_TONE} />
                      </div>
                      {r.description ? <p className="mt-1 text-sm text-muted-foreground">{r.description}</p> : null}
                      {r.mitigation ? <p className="mt-1 text-sm"><span className="font-medium">Plan:</span> {r.mitigation}</p> : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Likelihood {r.likelihood} · {r.ownerName ? `Owner ${r.ownerName}` : "No owner"} · Target{" "}
                        <span className={late ? "font-medium text-destructive" : ""}>{r.targetDate ? `${formatDate(r.targetDate)}${late ? " (overdue)" : ""}` : "not set"}</span>
                      </p>
                    </div>
                    {perms.write ? (
                      <div className="flex gap-1">
                        <RiskFormDialog projectId={projectId} risk={r} people={people} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${r.title}`}><Pencil /></Button>} />
                        {perms.moderate ? (
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.title}`}><Trash2 /></Button>}
                            title="Delete this entry?"
                            description="It will be permanently removed. Mark it resolved instead if you want to keep the record."
                            onConfirm={() => run(() => deleteRiskAction(r.id), { success: "Deleted" })}
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
