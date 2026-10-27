"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Search, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { EmptyState } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/dates";
import { initials } from "@/lib/format";
import { ROLE_LABELS, WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/permissions";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { createUserSchema } from "@/lib/validation";
import { addMemberAction, changeMemberRoleAction, createUserAction, removeMemberAction } from "./actions";

export interface UserRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
  ownedProjects: number;
  openTasks: number;
}

const ROLE_BADGE: Record<WorkspaceRole, string> = {
  owner: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  project_manager: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  contributor: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  viewer: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

type CreateInput = z.input<typeof createUserSchema>;
type CreateOutput = z.output<typeof createUserSchema>;

function AddExistingDialog({ workspaceId }: { workspaceId: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("contributor");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setEmail("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline"><Users /> Add existing user</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an existing user</DialogTitle>
          <DialogDescription>For people who already have an account (for example from another workspace).</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            const res = await run(() => addMemberAction(workspaceId, { email, role }), { success: "Member added" });
            if (res.ok) setOpen(false);
            else setError(res.fieldErrors?.email?.[0] ?? res.error);
          }}
        >
          <Field label="Email" htmlFor="ex-email" error={error ?? undefined}>
            <Input id="ex-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role" htmlFor="ex-role">
            <NativeSelect id="ex-role" value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
              {WORKSPACE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending || !email}>Add to workspace</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({ workspaceId }: { workspaceId: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateInput, unknown, CreateOutput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "", role: "contributor" },
  });

  async function submit() {
    const res = await run(() => createUserAction(workspaceId, getValues()), { success: "User created" });
    if (!res.ok) {
      const fields = Object.entries(res.fieldErrors ?? {});
      for (const [f, m] of fields) setError(f as keyof CreateInput, { message: m[0] });
      if (!fields.length) setError("email", { message: res.error });
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger render={<Button><UserPlus /> Create user</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a user</DialogTitle>
          <DialogDescription>
            Creates a sign-in account and adds it to this workspace. Share the temporary password securely.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="grid gap-4" noValidate>
          <Field label="Full name" htmlFor="cu-name" error={errors.name?.message}>
            <Input id="cu-name" autoComplete="off" aria-invalid={!!errors.name} {...register("name")} />
          </Field>
          <Field label="Email" htmlFor="cu-email" error={errors.email?.message}>
            <Input id="cu-email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...register("email")} />
          </Field>
          <Field label="Temporary password" htmlFor="cu-password" error={errors.password?.message} hint="At least 8 characters.">
            <Input id="cu-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
          </Field>
          <Field label="Role" htmlFor="cu-role" error={errors.role?.message}>
            <NativeSelect id="cu-role" {...register("role")}>
              {WORKSPACE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPanel({ workspaceId, currentUserId, members }: { workspaceId: string; currentUserId: string; members: UserRow[] }) {
  const { run } = useAction();
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | WorkspaceRole>("");

  const counts = WORKSPACE_ROLES.map((r) => ({ role: r, n: members.filter((m) => m.role === r).length }));
  const term = q.trim().toLowerCase();
  const rows = members.filter(
    (m) => (!roleFilter || m.role === roleFilter) && (!term || m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term)),
  );

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card className="p-4">
          <p className="text-2xl font-semibold">{members.length}</p>
          <p className="text-xs text-muted-foreground">Total members</p>
        </Card>
        {counts.map(({ role, n }) => (
          <Card key={role} className="p-4">
            <p className="text-2xl font-semibold">{n}</p>
            <p className="text-xs text-muted-foreground">
              {ROLE_LABELS[role]}
              {n === 1 ? "" : "s"}
            </p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search members" placeholder="Search name or email…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Filter by role" className="w-44" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "" | WorkspaceRole)}>
          <option value="">All roles</option>
          {WORKSPACE_ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </NativeSelect>
        <div className="ml-auto flex flex-wrap gap-2">
          <AddExistingDialog workspaceId={workspaceId} />
          <CreateUserDialog workspaceId={workspaceId} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Users />} title="No members match" description="Try a different search or role filter." />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-card shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Workspace members</caption>
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">Member</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">Role</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Projects owned</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Open tasks</th>
                <th scope="col" className="px-4 py-3 text-left font-medium">Joined</th>
                <th scope="col" className="px-4 py-3 text-right font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const me = m.userId === currentUserId;
                return (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {initials(m.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {m.name}
                            {me ? <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {me ? (
                        <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-medium", ROLE_BADGE[m.role])}>{ROLE_LABELS[m.role]}</span>
                      ) : (
                        <NativeSelect
                          aria-label={`Role of ${m.name}`}
                          className="w-44"
                          value={m.role}
                          onChange={(e) =>
                            run(() => changeMemberRoleAction(workspaceId, m.id, e.target.value), { success: `${m.name} is now ${ROLE_LABELS[e.target.value as WorkspaceRole]}` })
                          }
                        >
                          {WORKSPACE_ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </NativeSelect>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.ownedProjects}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.openTasks}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDate(m.joinedAt.slice(0, 10))}</td>
                    <td className="px-4 py-3 text-right">
                      {me ? null : (
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`}>
                              <Trash2 />
                            </Button>
                          }
                          title={`Remove ${m.name}?`}
                          description="They lose access to this workspace and their task assignments and project ownerships are cleared. Their account is not deleted."
                          confirmLabel="Remove"
                          onConfirm={() => run(() => removeMemberAction(workspaceId, m.id), { success: "Member removed" })}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{rows.length} of {members.length} members shown</p>
    </div>
  );
}
