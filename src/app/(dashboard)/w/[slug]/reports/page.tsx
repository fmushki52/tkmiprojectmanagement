import { Download, FileBarChart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { HealthBadge } from "@/components/projects/project-card";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/dates";
import { PROJECT_STATUS_TONE } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { getWorkspaceCtx } from "@/server/context";
import { listProjects } from "@/server/services/projects";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ params }: PageProps<"/w/[slug]/reports">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  const { items } = await listProjects(ws, { pageSize: 100, sort: "title", dir: "asc", scope: "all" });
  const canWorkspace = can(ws.role, "export:workspace");
  return (
    <>
      <PageHeader
        title="Reports"
        description="Generate project status reports and export data. Exports use live database records and your access level."
        actions={
          canWorkspace ? (
            <>
              <a className={cn(buttonVariants({ variant: "outline" }))} href={`/api/workspaces/${ws.workspaceId}/export?format=pdf`} download>
                <Download /> Portfolio PDF
              </a>
              <a className={cn(buttonVariants({ variant: "outline" }))} href={`/api/workspaces/${ws.workspaceId}/export?format=csv`} download>
                <Download /> Portfolio CSV
              </a>
            </>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={<FileBarChart />} title="No projects to report on" description="Create a project first." />
      ) : (
        <div className="grid gap-3">
          {items.map(({ project: p, metrics: m }) => (
            <Card key={p.id} className="flex-row flex-wrap items-center gap-3 p-4">
              <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: p.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.title}</p>
                <p className="text-xs text-muted-foreground">{formatDate(p.startDate, "MMM d, yyyy")} → {formatDate(p.plannedEndDate, "MMM d, yyyy")} · {m.progress}% complete</p>
              </div>
              <StatusBadge value={p.status} tones={PROJECT_STATUS_TONE} />
              <HealthBadge health={m.health} manual={m.healthIsManual} />
              <Link href={`/w/${slug}/reports/${p.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>Open report</Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
