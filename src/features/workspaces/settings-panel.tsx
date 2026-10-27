"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { deleteWorkspaceAction, renameWorkspaceAction } from "./actions";

export function SettingsPanel({
  workspaceId,
  slug,
  name,
  memberCount,
  canManage,
  canDelete,
}: {
  workspaceId: string;
  slug: string;
  name: string;
  memberCount: number;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [wsName, setWsName] = useState(name);

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>The workspace name is shown in the switcher and on reports.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await run(() => renameWorkspaceAction(workspaceId, { name: wsName }), { success: "Workspace renamed" });
            }}
          >
            <Field label="Workspace name" htmlFor="ws-name" className="min-w-60 flex-1">
              <Input id="ws-name" value={wsName} onChange={(e) => setWsName(e.target.value)} disabled={!canManage} />
            </Field>
            {canManage ? (
              <Button type="submit" disabled={pending || !wsName.trim() || wsName === name}>
                Save
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Members and roles</CardTitle>
            <CardDescription>
              {memberCount} member{memberCount === 1 ? "" : "s"}. Add people, create accounts and change roles in User Management.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/w/${slug}/users`} className={cn(buttonVariants({ variant: "outline" }))}>
              Open User Management
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {canDelete ? (
        <Card className="border border-destructive/40">
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>Deleting a workspace permanently removes all of its projects, tasks, files and history.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConfirmDialog
              trigger={<Button variant="destructive">Delete workspace</Button>}
              title={`Delete “${name}” permanently?`}
              description="Every project, milestone, task, update, file and notification in this workspace will be deleted. This cannot be undone."
              confirmLabel="Delete workspace"
              onConfirm={async () => {
                const res = await run(() => deleteWorkspaceAction(workspaceId), { success: "Workspace deleted", refresh: false });
                if (res.ok) {
                  router.replace("/");
                  router.refresh();
                }
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
