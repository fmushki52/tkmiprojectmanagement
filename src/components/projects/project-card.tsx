import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/dates";
import { HEALTH_TONE, PRIORITY_TONE, PROJECT_STATUS_TONE, label } from "@/lib/format";
import type { ProjectListItem } from "@/server/services/projects";

export function HealthBadge({ health, manual }: { health: keyof typeof HEALTH_TONE | null; manual?: boolean }) {
  if (!health) return null;
  return <StatusBadge value={health} tones={HEALTH_TONE} text={`${label(health)}${manual ? " (manual)" : ""}`} />;
}

export function ProjectCard({ slug, item }: { slug: string; item: ProjectListItem }) {
  const { project: p, metrics: m, ownerName } = item;
  return (
    <Link href={`/w/${slug}/projects/${p.id}`} className="group block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      <Card className="h-full gap-3 p-4 transition-shadow group-hover:shadow-md">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-medium group-hover:underline">{p.title}</h3>
            <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{p.description || "No description"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge value={p.status} tones={PROJECT_STATUS_TONE} />
          <StatusBadge value={p.priority} tones={PRIORITY_TONE} />
          <HealthBadge health={m.health} manual={m.healthIsManual} />
          {p.archivedAt ? <StatusBadge value="archived" tones={{ archived: "slate" }} /> : null}
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted-foreground">
              {m.counts.done}/{m.counts.total} tasks
            </span>
            <span className="font-medium">{m.progress}%</span>
          </div>
          <ProgressBar value={m.progress} label={`${p.title} progress`} />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            {formatDate(p.plannedEndDate, "MMM d, yyyy")}
          </span>
          <span className={m.daysOverdue ? "font-medium text-destructive" : undefined}>
            {p.status === "completed" || p.status === "cancelled" ? label(p.status) : m.daysOverdue ? `${m.daysOverdue}d overdue` : `${m.daysRemaining}d left`}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">{ownerName ? `Owner: ${ownerName}` : "No owner"}</div>
      </Card>
    </Link>
  );
}
