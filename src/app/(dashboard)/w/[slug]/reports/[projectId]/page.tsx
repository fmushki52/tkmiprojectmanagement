import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BurnupChart, MilestoneChart, StatusDonut } from "@/components/charts/charts";
import { PrintButton } from "@/components/layout/print-button";
import { HealthBadge } from "@/components/projects/project-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, isValidISODate } from "@/lib/dates";
import { PRIORITY_TONE, PROJECT_STATUS_TONE, TASK_STATUS_TONE, label } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { getWorkspaceCtx } from "@/server/context";
import { REPORT_SECTIONS, SECTION_LABELS, buildReportData, parseReportSections } from "@/server/services/reports";

export const metadata: Metadata = { title: "Project report" };

export default async function ProjectReportPage({ params, searchParams }: PageProps<"/w/[slug]/reports/[projectId]">) {
  const { slug, projectId } = await params;
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const ws = await getWorkspaceCtx(slug);
  if (!can(ws.role, "export:project")) notFound();
  const from = one("from") && isValidISODate(one("from")!) ? one("from") : undefined;
  const to = one("to") && isValidISODate(one("to")!) ? one("to") : undefined;
  const sections = sp.configured ? parseReportSections(Array.isArray(sp.sections) ? sp.sections.join(",") : (sp.sections ?? "")) : [...REPORT_SECTIONS];

  let d;
  try {
    d = await buildReportData(ws, projectId, { from, to, sections });
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const has = (s: (typeof REPORT_SECTIONS)[number]) => sections.includes(s);
  const m = d.metrics;
  const qs = new URLSearchParams({ from: d.range.from, to: d.range.to, sections: sections.join(",") }).toString();
  const base = `/api/projects/${projectId}/export`;
  const counts = { backlog: 0, todo: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const r of d.tasks) if (!d.tasks.some((x) => x.task.parentTaskId === r.task.id)) counts[r.task.status]++;
  const th = "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground";

  return (
    <div className="mx-auto max-w-4xl pt-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/w/${slug}/reports`} className="mr-auto text-sm text-muted-foreground hover:underline">← Reports</Link>
        <a className={cn(buttonVariants({ variant: "default" }))} href={`${base}?format=pdf&${qs}`} download><Download /> PDF</a>
        <a className={cn(buttonVariants({ variant: "outline" }))} href={`${base}?format=tasks-csv`} download><Download /> Tasks CSV</a>
        <a className={cn(buttonVariants({ variant: "outline" }))} href={`${base}?format=milestones-csv`} download><Download /> Milestones CSV</a>
        <PrintButton />
      </div>

      <form method="get" className="mb-6 grid gap-3 rounded-xl border p-4 print:hidden" aria-label="Report options">
        <input type="hidden" name="configured" value="1" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">From<Input type="date" name="from" defaultValue={d.range.from} /></label>
          <label className="grid gap-1 text-sm">To<Input type="date" name="to" defaultValue={d.range.to} /></label>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-sm font-medium">Sections</legend>
          {REPORT_SECTIONS.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="sections" value={s} defaultChecked={sections.includes(s)} className="size-4 accent-[var(--primary)]" /> {SECTION_LABELS[s]}
            </label>
          ))}
        </fieldset>
        <div><Button type="submit" variant="secondary" size="sm">Update report</Button></div>
      </form>

      <article className="grid gap-6" aria-label="Project status report">
        <header>
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">Project status report</p>
          <h1 className="text-3xl font-semibold tracking-tight">{d.project.title}</h1>
          {d.project.description ? <p className="mt-1 text-muted-foreground">{d.project.description}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground">Generated {d.generatedAt.toLocaleString()} · Period {formatDate(d.range.from)} – {formatDate(d.range.to)}</p>
        </header>

        {has("summary") ? (
          <section aria-labelledby="r-summary" className="grid gap-3">
            <h2 id="r-summary" className="text-lg font-semibold">Summary &amp; schedule</h2>
            <div className="flex flex-wrap gap-2">
              <StatusBadge value={d.project.status} tones={PROJECT_STATUS_TONE} />
              <StatusBadge value={d.project.priority} tones={PRIORITY_TONE} text={`${label(d.project.priority)} priority`} />
              <HealthBadge health={m.health} manual={m.healthIsManual} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                ["Owner", d.ownerName ?? "Unassigned"],
                ["Planned", `${formatDate(d.project.startDate)} – ${formatDate(d.project.plannedEndDate)}`],
                ["Actual", d.project.actualStartDate || d.project.actualEndDate ? `${formatDate(d.project.actualStartDate)} – ${formatDate(d.project.actualEndDate)}` : "Not recorded"],
                ["Days remaining", m.daysOverdue ? `${m.daysOverdue} overdue` : String(Math.max(0, m.daysRemaining))],
              ].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
              ))}
            </dl>
            <div>
              <div className="mb-1 flex justify-between text-sm"><span>Overall completion</span><strong>{m.progress}%</strong></div>
              <ProgressBar value={m.progress} size="lg" label="Overall completion" />
              <p className="mt-1 text-xs text-muted-foreground">{m.counts.done}/{m.counts.total} tasks done · {m.completedMilestones}/{m.totalMilestones} milestones · {m.overdueTasks} overdue tasks</p>
            </div>
            {m.computedHealth.reasons.length && m.health && !m.healthIsManual ? (
              <p className="text-sm text-muted-foreground">Why {label(m.health).toLowerCase()}: {m.computedHealth.reasons.join("; ")}.</p>
            ) : null}
          </section>
        ) : null}

        {has("charts") ? (
          <section aria-labelledby="r-charts" className="grid gap-3 sm:grid-cols-2">
            <h2 id="r-charts" className="sr-only">Charts</h2>
            <Card><CardHeader><CardTitle>Milestone completion</CardTitle></CardHeader><CardContent className="h-56"><MilestoneChart data={d.milestones.map(({ milestone: x, progress }) => ({ name: x.title, percent: progress?.percent ?? 0, source: progress?.source ?? "calculated", done: progress?.counts.done ?? 0, total: progress?.counts.total ?? 0 }))} /></CardContent></Card>
            <Card><CardHeader><CardTitle>Task status</CardTitle></CardHeader><CardContent className="h-56"><StatusDonut counts={counts} /></CardContent></Card>
          </section>
        ) : null}

        {has("milestones") ? (
          <section aria-labelledby="r-ms" className="grid gap-2">
            <h2 id="r-ms" className="text-lg font-semibold">Milestones</h2>
            {d.milestones.length === 0 ? <p className="text-sm text-muted-foreground">No milestones.</p> : (
              <table className="w-full text-sm"><thead><tr className="border-b"><th className={th}>Milestone</th><th className={th}>Status</th><th className={th}>Due</th><th className={th}>Completed</th><th className={th}>Owner</th><th className={th}>Progress</th></tr></thead>
                <tbody>{d.milestones.map(({ milestone: x, progress, ownerName }) => (
                  <tr key={x.id} className="border-b last:border-0"><td className="px-2 py-1.5 font-medium">{x.title}</td><td className="px-2 py-1.5">{label(x.status)}</td><td className="px-2 py-1.5">{formatDate(x.dueDate, "MMM d, yy")}</td><td className="px-2 py-1.5">{formatDate(x.actualDate, "MMM d, yy")}</td><td className="px-2 py-1.5">{ownerName ?? "—"}</td><td className="px-2 py-1.5">{progress?.percent ?? 0}%{progress?.source === "manual" ? " (manual)" : ""}</td></tr>
                ))}</tbody></table>
            )}
          </section>
        ) : null}

        {has("tasks") ? (
          <section aria-labelledby="r-tasks" className="grid gap-2">
            <h2 id="r-tasks" className="text-lg font-semibold">Task summary</h2>
            {d.tasks.length === 0 ? <p className="text-sm text-muted-foreground">No tasks.</p> : (
              <table className="w-full text-sm"><thead><tr className="border-b"><th className={th}>Task</th><th className={th}>Status</th><th className={th}>Priority</th><th className={th}>Assignee</th><th className={th}>Due</th></tr></thead>
                <tbody>{d.tasks.map((r) => (
                  <tr key={r.task.id} className="border-b last:border-0"><td className="px-2 py-1.5">{r.task.title}</td><td className="px-2 py-1.5"><StatusBadge value={r.task.status} tones={TASK_STATUS_TONE} /></td><td className="px-2 py-1.5">{label(r.task.priority)}</td><td className="px-2 py-1.5">{r.assignee ?? "—"}</td><td className="px-2 py-1.5">{formatDate(r.task.dueDate, "MMM d, yy")}</td></tr>
                ))}</tbody></table>
            )}
          </section>
        ) : null}

        {has("completed") ? (
          <section aria-labelledby="r-done" className="grid gap-1">
            <h2 id="r-done" className="text-lg font-semibold">Completed work</h2>
            {d.completed.length === 0 ? <p className="text-sm text-muted-foreground">No tasks were completed in this period.</p> : (
              <ul className="list-inside list-disc text-sm">{d.completed.map((r) => (<li key={r.task.id}>{r.task.title}{r.milestone ? <span className="text-muted-foreground"> — {r.milestone}</span> : null}</li>))}</ul>
            )}
          </section>
        ) : null}

        {has("upcoming") ? (
          <section aria-labelledby="r-up" className="grid gap-1">
            <h2 id="r-up" className="text-lg font-semibold">Upcoming activities</h2>
            {d.overdue.length + d.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nothing due in the next 14 days and nothing overdue.</p> : (
              <ul className="list-inside list-disc text-sm">
                {d.overdue.map((r) => (<li key={r.task.id} className="text-destructive">Overdue · {r.task.title} ({formatDate(r.task.dueDate, "MMM d")})</li>))}
                {d.upcoming.map((r) => (<li key={r.task.id}>{r.task.title} ({formatDate(r.task.dueDate, "MMM d")}){r.assignee ? ` — ${r.assignee}` : ""}</li>))}
              </ul>
            )}
          </section>
        ) : null}

        {has("risks") ? (
          <section aria-labelledby="r-risks" className="grid gap-1">
            <h2 id="r-risks" className="text-lg font-semibold">Risks &amp; blockers</h2>
            {d.risks.length === 0 ? <p className="text-sm text-muted-foreground">No open risks or blockers.</p> : (
              <ul className="grid gap-1 text-sm">{d.risks.map(({ risk: r, ownerName }) => (<li key={r.id}><strong>{r.title}</strong> — {label(r.kind)}, {r.severity} severity, {r.likelihood} likelihood{ownerName ? `, owner ${ownerName}` : ""}{r.targetDate ? `, target ${formatDate(r.targetDate)}` : ""}</li>))}</ul>
            )}
          </section>
        ) : null}

        {has("updates") ? (
          <section aria-labelledby="r-upd" className="grid gap-3">
            <h2 id="r-upd" className="text-lg font-semibold">Recent updates</h2>
            {d.updates.length === 0 ? <p className="text-sm text-muted-foreground">No updates published.</p> : d.updates.slice(0, 5).map((u) => (
              <div key={u.id} className="text-sm">
                <p className="font-medium">{u.title} <span className="font-normal text-muted-foreground">— {u.authorName ?? "Unknown"}, {formatDate(u.createdAt.toISOString().slice(0, 10))} · {label(u.status)}, {label(u.health)}, {u.progressSnapshot}% at the time</span></p>
                {u.progressSummary ? <p className="whitespace-pre-wrap text-muted-foreground">{u.progressSummary}</p> : null}
              </div>
            ))}
          </section>
        ) : null}

        {has("performance") ? (
          <section aria-labelledby="r-perf" className="grid gap-2">
            <h2 id="r-perf" className="text-lg font-semibold">Planned vs actual performance</h2>
            <Card><CardContent className="h-64 pt-4"><BurnupChart points={d.burnup.sufficient ? d.burnup.points : undefined} reason={d.burnup.sufficient ? undefined : d.burnup.reason} /></CardContent></Card>
            <p className="text-xs text-muted-foreground">Schedule elapsed {m.computedHealth.timeElapsedPercent}% · completion {m.progress}% · slip {m.computedHealth.slipPoints} points. Shares are of the current task set.</p>
          </section>
        ) : null}
      </article>
    </div>
  );
}
