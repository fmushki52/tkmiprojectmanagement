import { Link2 } from "lucide-react";
import { addDaysISO, daysBetween, formatDate, type ISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface TimelineProject {
  id: string;
  title: string;
  color: string;
  startDate: ISODate;
  plannedEndDate: ISODate;
  actualStartDate: ISODate | null;
  actualEndDate: ISODate | null;
  completed: boolean;
}
export interface TimelineMilestone {
  id: string;
  title: string;
  dueDate: ISODate;
  actualDate: ISODate | null;
  status: "not_started" | "in_progress" | "completed" | "at_risk";
  percent: number;
}
export interface TimelineTask {
  id: string;
  title: string;
  startDate: ISODate | null;
  dueDate: ISODate | null;
  status: "backlog" | "todo" | "in_progress" | "blocked" | "done";
  milestoneTitle: string | null;
  blockedBy: string[];
}

/**
 * Pure-CSS Gantt-style timeline (renders on the server). Positions are percentages of the visible
 * date range, which spans the project's planned and actual dates plus every dated item.
 */
export function Timeline({
  projects,
  milestones,
  tasks,
  today,
  showTasks = true,
}: {
  projects: TimelineProject[];
  milestones: TimelineMilestone[];
  tasks: TimelineTask[];
  today: ISODate;
  showTasks?: boolean;
}) {
  const dates: ISODate[] = [today];
  for (const p of projects) dates.push(p.startDate, p.plannedEndDate, ...(p.actualStartDate ? [p.actualStartDate] : []), ...(p.actualEndDate ? [p.actualEndDate] : []));
  for (const m of milestones) dates.push(m.dueDate, ...(m.actualDate ? [m.actualDate] : []));
  for (const t of tasks) dates.push(...[t.startDate, t.dueDate].filter((d): d is ISODate => !!d));
  dates.sort();
  const start = addDaysISO(dates[0], -2);
  const end = addDaysISO(dates[dates.length - 1], 2);
  const span = Math.max(1, daysBetween(start, end));
  const pct = (d: ISODate) => Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));
  const bar = (a: ISODate, b: ISODate) => ({ left: `${pct(a)}%`, width: `${Math.max(0.8, pct(b) - pct(a))}%` });

  // Month ticks.
  const ticks: { date: ISODate; label: string }[] = [];
  const first = new Date(`${start}T00:00:00`);
  for (let d = new Date(first.getFullYear(), first.getMonth() + 1, 1); d <= new Date(`${end}T00:00:00`); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    ticks.push({ date: iso, label: formatDate(iso, d.getMonth() === 0 ? "MMM yyyy" : "MMM") });
  }
  const showToday = today >= start && today <= end;

  const datedTasks = tasks.filter((t) => t.startDate || t.dueDate);
  const undated = tasks.length - datedTasks.length;

  const Row = ({ label, sub, children, strong }: { label: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; strong?: boolean }) => (
    <div className="grid grid-cols-[9rem_1fr] items-center border-b last:border-0 sm:grid-cols-[14rem_1fr]">
      <div className="min-w-0 py-2 pr-2">
        <p className={cn("truncate text-sm", strong && "font-medium")}>{label}</p>
        {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
      </div>
      <div className="relative h-9">{children}</div>
    </div>
  );

  const milestoneColor = (m: TimelineMilestone) =>
    m.status === "completed" ? "bg-emerald-500" : m.dueDate < today ? "bg-red-500" : m.status === "at_risk" ? "bg-amber-500" : "bg-sky-500";
  const taskColor = (t: TimelineTask) =>
    t.status === "done" ? "bg-emerald-500" : t.dueDate && t.dueDate < today ? "bg-red-500" : t.status === "blocked" ? "bg-amber-500" : t.status === "in_progress" ? "bg-sky-500" : "bg-slate-400 dark:bg-slate-500";

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[9rem_1fr] border-b bg-muted/40 text-xs text-muted-foreground sm:grid-cols-[14rem_1fr]">
          <div className="px-0 py-2 pl-3">Item</div>
          <div className="relative h-8" aria-hidden>
            {ticks.map((t) => (
              <span key={t.date} className="absolute top-2 border-l pl-1" style={{ left: `${pct(t.date)}%` }}>{t.label}</span>
            ))}
          </div>
        </div>
        <div className="relative px-3">
          {projects.map((p) => (
            <Row key={p.id} strong label={<span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />{p.title}</span>} sub={`${formatDate(p.startDate, "MMM d")} – ${formatDate(p.plannedEndDate, "MMM d, yyyy")}`}>
              <div className="absolute top-2 h-3 rounded-full opacity-35" style={{ ...bar(p.startDate, p.plannedEndDate), backgroundColor: p.color }} title={`Planned ${p.startDate} → ${p.plannedEndDate}`} />
              {p.actualStartDate ? (
                <div className="absolute top-5 h-1.5 rounded-full" style={{ ...bar(p.actualStartDate, p.actualEndDate ?? (today < p.plannedEndDate ? today : today)), backgroundColor: p.color }} title={`Actual ${p.actualStartDate} → ${p.actualEndDate ?? "ongoing"}`} />
              ) : null}
              {showToday ? <div className="absolute inset-y-0 w-px bg-primary/60" style={{ left: `${pct(today)}%` }} title={`Today (${today})`} /> : null}
            </Row>
          ))}
          {milestones.map((m) => (
            <Row key={m.id} label={<span className="flex items-center gap-1.5">◆ {m.title}</span>} sub={`Due ${formatDate(m.dueDate, "MMM d")} · ${m.percent}%${m.status !== "completed" && m.dueDate < today ? " · overdue" : ""}`}>
              <div className={cn("absolute top-2.5 size-4 -translate-x-1/2 rotate-45 rounded-[3px]", milestoneColor(m))} style={{ left: `${pct(m.dueDate)}%` }} title={`${m.title}: due ${m.dueDate}`} />
              {m.actualDate && m.actualDate !== m.dueDate ? (
                <div className="absolute top-3 size-3 -translate-x-1/2 rounded-full border-2 border-emerald-500 bg-background" style={{ left: `${pct(m.actualDate)}%` }} title={`Completed ${m.actualDate}`} />
              ) : null}
              {showToday ? <div className="absolute inset-y-0 w-px bg-primary/40" style={{ left: `${pct(today)}%` }} /> : null}
            </Row>
          ))}
          {showTasks &&
            datedTasks.map((t) => {
              const s = t.startDate ?? t.dueDate!;
              const e = t.dueDate ?? t.startDate!;
              return (
                <Row key={t.id} label={<span className="flex items-center gap-1.5 pl-3">{t.title}{t.blockedBy.length ? <Link2 className="size-3 shrink-0 text-muted-foreground" aria-label={`Depends on ${t.blockedBy.join(", ")}`} /> : null}</span>} sub={[t.milestoneTitle, t.blockedBy.length ? `after ${t.blockedBy.join(", ")}` : null].filter(Boolean).join(" · ") || undefined}>
                  <div className={cn("absolute top-3 h-3 rounded-full", taskColor(t))} style={bar(s, e)} title={`${t.title}: ${s} → ${e}`} />
                  {showToday ? <div className="absolute inset-y-0 w-px bg-primary/30" style={{ left: `${pct(today)}%` }} /> : null}
                </Row>
              );
            })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-emerald-500" /> Completed</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-sky-500" /> In progress / on schedule</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-red-500" /> Overdue</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-amber-500" /> Blocked / at risk</span>
        <span className="flex items-center gap-1"><span className="h-3 w-px bg-primary" /> Today</span>
        <span>Thick bar = planned · thin bar = actual · ◆ = milestone due · ○ = completed on</span>
        {undated > 0 && showTasks ? <span>{undated} task(s) without dates are not shown</span> : null}
      </div>
    </div>
  );
}
