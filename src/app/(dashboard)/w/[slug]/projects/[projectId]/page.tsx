import { AlertTriangle, CalendarClock, CheckCircle2, Flag, ListChecks, ShieldAlert, Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BurnupChart, MilestoneChart, StatusDonut } from "@/components/charts/charts";
import { PageBand } from "@/components/layout/page-header";
import { HealthBadge } from "@/components/projects/project-card";
import { Timeline } from "@/components/projects/timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { AttachmentsPanel } from "@/features/attachments/attachments-panel";
import { RisksPanel, type RiskItem } from "@/features/collab/risks-panel";
import { UpdatesPanel, type UpdateItem } from "@/features/collab/updates-panel";
import { type MilestoneItem, MilestonesPanel } from "@/features/milestones/milestones-panel";
import { ProjectActions } from "@/features/projects/project-actions";
import { TasksPanel } from "@/features/tasks/tasks-panel";
import type { TaskItem } from "@/features/tasks/types";
import { formatDate } from "@/lib/dates";
import { PRIORITY_TONE, PROJECT_STATUS_TONE, label } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { AppError } from "@/lib/errors";
import { getWorkspaceCtx } from "@/server/context";
import { describeActivity } from "@/server/services/activity";
import { getProjectOverview } from "@/server/services/overview";

export const metadata: Metadata = { title: "Project" };

const TABS = [
  ["overview", "Overview"],
  ["milestones", "Milestones"],
  ["tasks", "Tasks"],
  ["timeline", "Timeline"],
  ["updates", "Updates"],
  ["risks", "Risks & blockers"],
  ["files", "Files"],
] as const;

export default async function ProjectPage({ params, searchParams }: PageProps<"/w/[slug]/projects/[projectId]">) {
  const { slug, projectId } = await params;
  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = TABS.find(([k]) => k === tabParam)?.[0] ?? (sp.task ? "tasks" : "overview");
  const ws = await getWorkspaceCtx(slug);

  let o;
  try {
    o = await getProjectOverview(ws, projectId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { project: p, metrics: m, owner } = o;
  const names = new Map(o.workspaceMembers.map((x) => [x.userId, x.name]));
  const people = o.workspaceMembers.map((x) => ({ id: x.userId, name: x.name }));
  const perms = {
    update: can(ws.role, "project:update"),
    archive: can(ws.role, "project:archive"),
    delete: can(ws.role, "project:delete"),
    export: can(ws.role, "export:project"),
  };

  const taskItems: TaskItem[] = o.tasks.map((r) => ({
    id: r.task.id,
    title: r.task.title,
    description: r.task.description,
    status: r.task.status,
    priority: r.task.priority,
    assigneeId: r.task.assigneeId,
    assigneeName: r.assigneeName,
    milestoneId: r.task.milestoneId,
    milestoneTitle: r.milestoneTitle,
    parentTaskId: r.task.parentTaskId,
    hasSubtasks: r.hasSubtasks,
    startDate: r.task.startDate,
    dueDate: r.task.dueDate,
    estimateHours: r.task.estimateHours,
    actualHours: r.task.actualHours,
    progress: r.task.progress,
    position: r.task.position,
    labels: r.labels.map((l) => l.name),
    projectId: r.task.projectId,
  }));
  const milestoneItems: MilestoneItem[] = o.milestones.map(({ milestone: ms, ownerName, progress }) => ({
    id: ms.id,
    title: ms.title,
    description: ms.description,
    dueDate: ms.dueDate,
    actualDate: ms.actualDate,
    ownerId: ms.ownerId,
    status: ms.status,
    priority: ms.priority,
    progressMode: ms.progressMode,
    manualProgress: ms.manualProgress,
    ownerName,
    percent: progress?.percent ?? 0,
    source: progress?.source ?? "calculated",
    done: progress?.counts.done ?? 0,
    total: progress?.counts.total ?? 0,
  }));
  const updateItems: UpdateItem[] = o.updates.map(({ update: u, authorName, revisions }) => ({
    id: u.id,
    title: u.title,
    status: u.status,
    health: u.health,
    progressSummary: u.progressSummary,
    completedWork: u.completedWork,
    nextSteps: u.nextSteps,
    risksBlockers: u.risksBlockers,
    decisions: u.decisions,
    progressSnapshot: u.progressSnapshot,
    authorId: u.authorId,
    authorName,
    createdAt: u.createdAt.toISOString(),
    revisions,
    retractedAt: u.retractedAt?.toISOString() ?? null,
    retractedByName: u.retractedById ? (names.get(u.retractedById) ?? null) : null,
    retractReason: u.retractReason,
  }));
  const riskItems: RiskItem[] = o.risks.map(({ risk: r, ownerName }) => ({
    id: r.id, kind: r.kind, title: r.title, description: r.description, severity: r.severity, likelihood: r.likelihood,
    ownerId: r.ownerId, ownerName, mitigation: r.mitigation, status: r.status, targetDate: r.targetDate,
  }));

  const leaf = o.tasks.filter((r) => o.leafTaskIds.has(r.task.id));
  const statusCounts = { backlog: 0, todo: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const r of leaf) statusCounts[r.task.status]++;
  const openRisks = riskItems.filter((r) => r.status === "open" || r.status === "mitigating");
  const blockers = openRisks.filter((r) => r.kind === "blocker" || r.severity === "critical");
  const taskTitle = new Map(o.tasks.map((r) => [r.task.id, r.task.title]));
  const timelineTasks = o.tasks.map((r) => ({
    id: r.task.id,
    title: r.task.title,
    startDate: r.task.startDate,
    dueDate: r.task.dueDate,
    status: r.task.status,
    milestoneTitle: r.milestoneTitle,
    blockedBy: o.dependencies.filter((d) => d.taskId === r.task.id).map((d) => taskTitle.get(d.dependsOnTaskId) ?? "task"),
  }));
  const timelineMilestones = milestoneItems.map((x) => ({ id: x.id, title: x.title, dueDate: x.dueDate, actualDate: x.actualDate, status: x.status, percent: x.percent }));
  const timelineProject = [{ id: p.id, title: p.title, color: p.color, startDate: p.startDate, plannedEndDate: p.plannedEndDate, actualStartDate: p.actualStartDate, actualEndDate: p.actualEndDate, completed: p.status === "completed" }];

  const card = (icon: React.ReactNode, title: string, value: React.ReactNode, sub?: string, alert?: boolean) => (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground", alert && "bg-red-700 text-white")}>{icon}</span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-xl leading-tight font-semibold">{value}</p>
          {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
        </div>
      </div>
    </Card>
  );

  const closed = p.status === "completed" || p.status === "cancelled";

  return (
    <>
      <PageBand>
      <Link href={`/w/${slug}/projects`} className="mb-2 inline-block text-sm text-foreground/75 hover:underline">← Projects</Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: p.color }} />
            <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
            <StatusBadge value={p.status} tones={PROJECT_STATUS_TONE} />
            <StatusBadge value={p.priority} tones={PRIORITY_TONE} text={`${label(p.priority)} priority`} />
            <HealthBadge health={m.health} manual={m.healthIsManual} />
            {p.archivedAt ? <StatusBadge value="archived" tones={{ archived: "slate" }} /> : null}
          </div>
          {p.description ? <p className="mt-1 max-w-3xl text-sm text-foreground/75">{p.description}</p> : null}
          <p className="mt-1 text-sm text-foreground/75">
            {formatDate(p.startDate)} → {formatDate(p.plannedEndDate)} · Owner: {owner?.name ?? "none"}
            {p.tags.length ? ` · ${p.tags.join(", ")}` : ""}
          </p>
        </div>
        <ProjectActions
          slug={slug}
          workspaceId={ws.workspaceId}
          archived={!!p.archivedAt}
          people={people.map((x) => ({ userId: x.id, name: x.name }))}
          perms={perms}
          project={{
            id: p.id, title: p.title, description: p.description, scope: p.scope, startDate: p.startDate, plannedEndDate: p.plannedEndDate,
            actualStartDate: p.actualStartDate, actualEndDate: p.actualEndDate, ownerId: p.ownerId, status: p.status, priority: p.priority,
            health: p.health, color: p.color, tags: p.tags, progressWeighting: p.progressWeighting, memberIds: o.members.map((x) => x.userId),
          }}
        />
      </header>
      </PageBand>

      <div className="mb-6 rounded-2xl bg-card p-5 shadow-sm">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Overall progress</p>
            <p className="text-3xl font-semibold">{m.progress}%</p>
          </div>
          <p className="text-right text-sm text-muted-foreground">
            {m.counts.done} of {m.counts.total} tasks done · {m.counts.remaining} remaining
            <span className="block text-xs">{p.progressWeighting === "effort" ? "Weighted by estimated effort" : "Equal weighting"}</span>
          </p>
        </div>
        <ProgressBar value={m.progress} size="lg" label="Overall project progress" />
      </div>

      <nav aria-label="Project sections" className="mb-6 flex gap-1 overflow-x-auto border-b">
        {TABS.map(([key, text]) => (
          <Link
            key={key}
            href={`/w/${slug}/projects/${p.id}?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn("border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {text}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {card(<ListChecks className="size-4" />, "Tasks done", `${m.counts.done}/${m.counts.total}`, `${m.counts.inProgress} in progress`)}
            {card(<AlertTriangle className="size-4" />, "Overdue tasks", m.overdueTasks, m.blockedTasks ? `${m.blockedTasks} blocked` : undefined, m.overdueTasks > 0)}
            {card(<Flag className="size-4" />, "Milestones done", `${m.completedMilestones}/${m.totalMilestones}`, m.overdueMilestones ? `${m.overdueMilestones} overdue` : undefined, m.overdueMilestones > 0)}
            {card(<Timer className="size-4" />, m.daysOverdue ? "Days overdue" : "Days remaining", closed ? "—" : m.daysOverdue || m.daysRemaining, `Planned end ${formatDate(p.plannedEndDate, "MMM d")}`, m.daysOverdue > 0)}
            {card(<ShieldAlert className="size-4" />, "Open critical risks", m.openCriticalRisks, undefined, m.openCriticalRisks > 0)}
            {card(<CheckCircle2 className="size-4" />, "Time elapsed", `${m.computedHealth.timeElapsedPercent}%`, `vs ${m.progress}% complete`)}
          </div>

          {m.health && m.computedHealth.reasons.length > 0 && !m.healthIsManual ? (
            <Card className="gap-1 border-l-4 border-l-amber-500 p-4">
              <p className="text-sm font-medium">Why this project is {label(m.health).toLowerCase()}</p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {m.computedHealth.reasons.map((r) => (<li key={r}>{r}</li>))}
              </ul>
            </Card>
          ) : m.healthIsManual ? (
            <p className="text-sm text-muted-foreground">Health was set manually to <strong>{label(m.health)}</strong>. Automatic assessment: {m.computedHealth.health ? label(m.computedHealth.health) : "n/a"}.</p>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Milestone completion</CardTitle></CardHeader>
              <CardContent className="h-64"><MilestoneChart data={milestoneItems.map((x) => ({ name: x.title, percent: x.percent, source: x.source, done: x.done, total: x.total }))} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Task status distribution</CardTitle></CardHeader>
              <CardContent className="h-64"><StatusDonut counts={statusCounts} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Planned vs actual</CardTitle></CardHeader>
              <CardContent className="h-64">
                <BurnupChart points={o.burnup.sufficient ? o.burnup.points : undefined} reason={o.burnup.sufficient ? undefined : o.burnup.reason} />
              </CardContent>
            </Card>
          </div>

          <section aria-label="Project timeline" className="grid gap-2">
            <h2 className="text-base font-semibold">Timeline</h2>
            <Timeline projects={timelineProject} milestones={timelineMilestones} tasks={[]} today={o.today} showTasks={false} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Upcoming deadlines (14 days) &amp; overdue</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                {o.deadlines.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due soon.</p> : null}
                {o.deadlines.slice(0, 10).map((d) => (
                  <div key={`${d.kind}-${d.id}`} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {d.kind === "milestone" ? <Flag className="size-3.5 shrink-0 text-muted-foreground" /> : <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{d.title}</span>
                    </span>
                    <span className={cn("shrink-0 text-xs", d.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {d.overdue ? "Overdue · " : ""}{formatDate(d.date, "MMM d")}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Risks &amp; blockers</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                {blockers.length === 0 ? <p className="text-sm text-muted-foreground">No open critical risks or blockers.</p> : null}
                {blockers.map((r) => (
                  <Link key={r.id} href={`/w/${slug}/projects/${p.id}?tab=risks`} className="flex items-center justify-between gap-2 text-sm hover:underline">
                    <span className="truncate">{r.title}</span>
                    <StatusBadge value={r.kind} tones={{ risk: "violet", issue: "orange", blocker: "red" }} />
                  </Link>
                ))}
                {m.blockedTasks > 0 ? <p className="text-xs text-muted-foreground">{m.blockedTasks} task(s) are blocked.</p> : null}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {o.activity.length === 0 ? <p className="text-muted-foreground">No activity yet.</p> : null}
                {o.activity.slice(0, 10).map((a) => (
                  <p key={a.id}>
                    <span className="font-medium">{a.actorName ?? "Someone"}</span> {describeActivity(a)}
                    <time className="block text-xs text-muted-foreground" dateTime={a.createdAt.toISOString()}>{a.createdAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
                  </p>
                ))}
              </CardContent>
            </Card>
            <div className="grid content-start gap-6">
              <Card>
                <CardHeader><CardTitle>Latest update</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  {updateItems.filter((u) => !u.retractedAt)[0] ? (
                    <Link href={`/w/${slug}/projects/${p.id}?tab=updates`} className="block hover:underline">
                      <span className="font-medium">{updateItems.filter((u) => !u.retractedAt)[0].title}</span>
                      <span className="block text-xs text-muted-foreground">{updateItems.filter((u) => !u.retractedAt)[0].authorName} · {formatDate(updateItems.filter((u) => !u.retractedAt)[0].createdAt.slice(0, 10))}</span>
                    </Link>
                  ) : (
                    <p className="text-muted-foreground">No updates published yet.</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Team</CardTitle></CardHeader>
                <CardContent className="grid gap-1.5 text-sm">
                  {o.members.length === 0 ? <p className="text-muted-foreground">No team members assigned.</p> : null}
                  {o.members.map((x) => (
                    <p key={x.userId} className="flex justify-between"><span>{x.name}</span>{x.userId === p.ownerId ? <span className="text-xs text-muted-foreground">Owner</span> : null}</p>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "milestones" ? (
        <MilestonesPanel projectId={p.id} milestones={milestoneItems} people={people} currentUserId={ws.userId} perms={{ write: can(ws.role, "milestone:write"), comment: can(ws.role, "comment:write"), moderate: can(ws.role, "update:moderate") }} />
      ) : null}

      {tab === "tasks" ? (
        <TasksPanel
          projectId={p.id}
          tasks={taskItems}
          milestones={milestoneItems.map((x) => ({ id: x.id, name: x.title }))}
          people={people}
          currentUserId={ws.userId}
          leafIds={[...o.leafTaskIds]}
          perms={{ update: can(ws.role, "task:update"), create: can(ws.role, "task:create"), delete: can(ws.role, "task:delete"), comment: can(ws.role, "comment:write"), moderate: can(ws.role, "update:moderate"), attach: can(ws.role, "attachment:write") }}
        />
      ) : null}

      {tab === "timeline" ? (
        <div className="grid gap-3">
          {m.health && m.health !== "on_track" && m.computedHealth.reasons.length ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <strong>Schedule risk:</strong> {m.computedHealth.reasons.join("; ")}.
            </p>
          ) : null}
          <Timeline projects={timelineProject} milestones={timelineMilestones} tasks={timelineTasks} today={o.today} />
        </div>
      ) : null}

      {tab === "updates" ? (
        <UpdatesPanel projectId={p.id} updates={updateItems} projectStatus={p.status} people={people} currentUserId={ws.userId} perms={{ publish: can(ws.role, "update:publish"), moderate: can(ws.role, "update:moderate"), comment: can(ws.role, "comment:write") }} />
      ) : null}

      {tab === "files" ? (
        <AttachmentsPanel projectId={p.id} currentUserId={ws.userId} perms={{ upload: can(ws.role, "attachment:write"), moderate: can(ws.role, "update:moderate") }} />
      ) : null}

      {tab === "risks" ? <RisksPanel projectId={p.id} risks={riskItems} people={people} perms={{ write: can(ws.role, "risk:write"), moderate: can(ws.role, "update:moderate") }} /> : null}
    </>
  );
}
