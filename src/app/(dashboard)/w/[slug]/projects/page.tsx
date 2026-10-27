import { FolderKanban, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { ProjectCard } from "@/components/projects/project-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { ProjectFilters } from "@/features/projects/project-filters";
import { ProjectFormDialog } from "@/features/projects/project-form";
import { can } from "@/lib/permissions";
import { PRIORITIES, PROJECT_STATUSES } from "@/lib/validation";
import { getWorkspaceCtx } from "@/server/context";
import { listProjects, type ProjectListQuery } from "@/server/services/projects";
import { listMembers } from "@/server/services/workspaces";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (allowed as readonly string[]).includes(v ?? "") ? (v as T) : undefined;

export default async function ProjectsPage({ params, searchParams }: PageProps<"/w/[slug]/projects">) {
  const { slug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const ws = await getWorkspaceCtx(slug);
  const query: ProjectListQuery = {
    q: one("q"),
    status: pick(one("status"), PROJECT_STATUSES),
    priority: pick(one("priority"), PRIORITIES),
    scope: pick(one("scope"), ["active", "archived", "all"] as const),
    sort: pick(one("sort"), ["updated", "title", "start", "end", "priority", "status"] as const),
    dir: pick(one("dir"), ["asc", "desc"] as const),
    page: Number(one("page")) || 1,
  };
  const [list, members] = await Promise.all([listProjects(ws, query), listMembers(ws)]);
  const canCreate = can(ws.role, "project:create");
  const filtered = !!(query.q || query.status || query.priority || (query.scope && query.scope !== "active"));
  const hrefFor = (page: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "page") next.set(k, v);
    next.set("page", String(page));
    return `/w/${slug}/projects?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${list.total} project${list.total === 1 ? "" : "s"}`}
        actions={
          canCreate ? (
            <ProjectFormDialog workspaceId={ws.workspaceId} slug={slug} people={members} trigger={<Button><Plus /> New project</Button>} />
          ) : null
        }
      />
      <ProjectFilters />
      {list.items.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title={filtered ? "No projects match your filters" : "No projects yet"}
          description={filtered ? "Try clearing the search or filters." : canCreate ? "Create your first project to start planning milestones and tasks." : "Ask a project manager or owner to create one."}
          action={
            !filtered && canCreate ? (
              <ProjectFormDialog workspaceId={ws.workspaceId} slug={slug} people={members} trigger={<Button><Plus /> New project</Button>} />
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.items.map((item) => (
            <ProjectCard key={item.project.id} slug={slug} item={item} />
          ))}
        </div>
      )}
      {list.pageCount > 1 ? (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-3 text-sm">
          {list.page > 1 ? (
            <Link className={cn(buttonVariants({ variant: "outline" }))} href={hrefFor(list.page - 1)}>Previous</Link>
          ) : null}
          <span className="text-muted-foreground">Page {list.page} of {list.pageCount}</span>
          {list.page < list.pageCount ? (
            <Link className={cn(buttonVariants({ variant: "outline" }))} href={hrefFor(list.page + 1)}>Next</Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
