import { AlertTriangle, CheckCircle2, ClipboardList, FolderKanban, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { HealthBadge } from "@/components/projects/project-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectFormDialog } from "@/features/projects/project-form";
import { formatDate, todayISO } from "@/lib/dates";
import { PRIORITY_TONE, PROJECT_STATUS_TONE } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getWorkspaceCtx } from "@/server/context";
import { describeActivity, listWorkspaceActivity } from "@/server/services/activity";
import { listProjects } from "@/server/services/projects";
import { listTasks } from "@/server/services/tasks";
import { listMembers } from "@/server/services/workspaces";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  const today = todayISO();
  const [projects, myTasks, overdueMine, members, activity] = await Promise.all([
    listProjects(ws, { pageSize: 100, sort: "end", dir: "asc" }, today),
    listTasks(ws, { assigneeId: ws.userId, status: "open", sort: "due", limit: 8 }, today),
    listTasks(ws, { assigneeId: ws.userId, due: "overdue" }, today),
    listMembers(ws),
    listWorkspaceActivity(ws, null, 8),
  ]);
  const items = projects.items;
  const active = items.filter((i) => !["completed", "cancelled"].includes(i.project.status));
  const atRisk = active.filter((i) => i.metrics.health === "at_risk" || i.metrics.health === "off_track");
  const overdueAll = active.reduce((a, i) => a + i.metrics.overdueTasks, 0);
  const canCreate = can(ws.role, "project:create");

  if (items.length === 0) {
    return (
      <>
        <PageHeader title={`Welcome to ${ws.workspaceName}`} description="Create your first project to start tracking milestones, tasks and progress." />
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          description={canCreate ? "Projects hold milestones, tasks, updates and risks." : "Ask a project manager or owner to create a project."}
          action={canCreate ? <ProjectFormDialog workspaceId={ws.workspaceId} slug={slug} people={members} trigger={<Button><Plus /> New project</Button>} /> : null}
        />
      </>
    );
  }

  const stat = (icon: React.ReactNode, label: string, value: number, tone?: string) => (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className={`grid size-11 place-items-center rounded-full text-white ${tone || "bg-primary"}`}>{icon}</span>
        <div>
          <p className="text-2xl leading-none font-semibold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Overview of ${ws.workspaceName}`}
        actions={canCreate ? <ProjectFormDialog workspaceId={ws.workspaceId} slug={slug} people={members} trigger={<Button><Plus /> New project</Button>} /> : null}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat(<FolderKanban className="size-4" />, "Active projects", active.length)}
        {stat(<AlertTriangle className="size-4" />, "At risk or off track", atRisk.length, atRisk.length ? "bg-amber-600" : "")}
        {stat(<ClipboardList className="size-4" />, "Open tasks assigned to me", myTasks.length)}
        {stat(<CheckCircle2 className="size-4" />, "Overdue tasks (all projects)", overdueAll, overdueAll ? "bg-red-700" : "")}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {items.slice(0, 8).map(({ project: p, metrics: m }) => (
              <Link key={p.id} href={`/w/${slug}/projects/${p.id}`} className="group grid gap-1.5 rounded-lg p-2 -m-2 hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="font-medium group-hover:underline">{p.title}</span>
                  <StatusBadge value={p.status} tones={PROJECT_STATUS_TONE} />
                  <StatusBadge value={p.priority} tones={PRIORITY_TONE} />
                  <HealthBadge health={m.health} manual={m.healthIsManual} />
                  <span className="ml-auto text-xs text-muted-foreground">Due {formatDate(p.plannedEndDate, "MMM d")}</span>
                </div>
                <div className="flex items-center gap-3">
                  <ProgressBar value={m.progress} label={`${p.title} progress`} />
                  <span className="w-10 text-right text-xs font-medium">{m.progress}%</span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>My upcoming tasks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {myTasks.length === 0 ? <p className="text-sm text-muted-foreground">Nothing assigned to you.</p> : null}
              {myTasks.map(({ task, projectTitle }) => (
                <Link key={task.id} href={`/w/${slug}/projects/${task.projectId}?tab=tasks&task=${task.id}`} className="rounded-md p-1.5 -m-1.5 text-sm hover:bg-muted/60">
                  <span className="block truncate font-medium">{task.title}</span>
                  <span className={`text-xs ${task.dueDate && task.dueDate < today ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                    {projectTitle} · {task.dueDate ? `${task.dueDate < today ? "Overdue · " : ""}${formatDate(task.dueDate, "MMM d")}` : "No due date"}
                  </span>
                </Link>
              ))}
              {overdueMine.length > 0 ? (
                <Link href={`/w/${slug}/tasks?due=overdue`} className="text-xs font-medium text-destructive hover:underline">
                  {overdueMine.length} overdue — view all
                </Link>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {activity.length === 0 ? <p className="text-muted-foreground">No activity yet.</p> : null}
              {activity.map((a) => (
                <p key={a.id}>
                  <span className="font-medium">{a.actorName ?? "Someone"}</span> {describeActivity(a)}
                  <span className="block text-xs text-muted-foreground">{formatDate(a.createdAt.toISOString().slice(0, 10), "MMM d")}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
