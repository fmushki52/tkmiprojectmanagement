"use client";

import { Archive, ArchiveRestore, Download, FileText, MoreHorizontal, Pencil, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { archiveProjectAction, deleteProjectAction } from "./actions";
import { type EditableProject, type PersonOption, ProjectFormDialog } from "./project-form";

export function ProjectActions({
  slug,
  workspaceId,
  project,
  archived,
  people,
  perms,
}: {
  slug: string;
  workspaceId: string;
  project: EditableProject;
  archived: boolean;
  people: PersonOption[];
  perms: { update: boolean; archive: boolean; delete: boolean; export: boolean };
}) {
  const router = useRouter();
  const { run } = useAction();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const base = `/api/projects/${project.id}/export`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {perms.export ? (
        <>
          <Link href={`/w/${slug}/reports/${project.id}`} className={cn(buttonVariants({ variant: "outline" }))}>
            <FileText /> Report
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <Download /> Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Download</DropdownMenuLabel>
                <DropdownMenuItem render={<a href={`${base}?format=pdf`} download />}>PDF project summary</DropdownMenuItem>
                <DropdownMenuItem render={<a href={`${base}?format=tasks-csv`} download />}>Tasks (CSV)</DropdownMenuItem>
                <DropdownMenuItem render={<a href={`${base}?format=milestones-csv`} download />}>Milestones (CSV)</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href={`/w/${slug}/reports/${project.id}`} />}>
                <Printer /> Printable report…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      {perms.update ? (
        <ProjectFormDialog workspaceId={workspaceId} slug={slug} people={people} project={project} trigger={<Button variant="outline"><Pencil /> Edit</Button>} />
      ) : null}
      {perms.archive || perms.delete ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More project actions" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {perms.archive ? (
              <DropdownMenuItem onClick={() => run(() => archiveProjectAction(project.id, !archived), { success: archived ? "Project restored" : "Project archived" })}>
                {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore project" : "Archive project"}
              </DropdownMenuItem>
            ) : null}
            {perms.delete ? (
              <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
                <Trash2 /> Delete project…
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {/* Rendered outside the menu so it stays mounted after the menu closes. */}
      {perms.delete ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Delete “${project.title}” permanently?`}
          description="All milestones, tasks, comments, updates, risks, files and activity in this project are deleted and cannot be recovered. Consider archiving instead."
          confirmLabel="Delete project"
          onConfirm={async () => {
            const res = await run(() => deleteProjectAction(project.id), { success: "Project deleted", refresh: false });
            if (res.ok) {
              router.replace(`/w/${slug}/projects`);
              router.refresh();
            }
          }}
        />
      ) : null}
    </div>
  );
}
