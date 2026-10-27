import { CalendarRange } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { Timeline } from "@/components/projects/timeline";
import { getWorkspaceCtx } from "@/server/context";
import { getWorkspaceTimeline } from "@/server/services/overview";

export const metadata: Metadata = { title: "Timeline" };

export default async function TimelinePage({ params }: PageProps<"/w/[slug]/timeline">) {
  const { slug } = await params;
  const ws = await getWorkspaceCtx(slug);
  const t = await getWorkspaceTimeline(ws);
  const active = t.projects.filter((i) => !i.project.archivedAt);
  return (
    <>
      <PageHeader title="Timeline" description="Planned and actual schedules and milestones across active projects." />
      {active.length === 0 ? (
        <EmptyState icon={<CalendarRange />} title="Nothing to show yet" description="Create a project to see its schedule here." />
      ) : (
        <Timeline
          today={t.today}
          showTasks={false}
          projects={active.map((i) => ({
            id: i.project.id, title: i.project.title, color: i.project.color, startDate: i.project.startDate, plannedEndDate: i.project.plannedEndDate,
            actualStartDate: i.project.actualStartDate, actualEndDate: i.project.actualEndDate, completed: i.project.status === "completed",
          }))}
          milestones={t.milestones.map((m) => ({
            id: m.id, title: `${active.find((i) => i.project.id === m.projectId)?.project.title ?? ""} · ${m.title}`, dueDate: m.dueDate, actualDate: m.actualDate, status: m.status,
            percent: active.find((i) => i.project.id === m.projectId)?.metrics.milestones[m.id]?.percent ?? 0,
          }))}
          tasks={[]}
        />
      )}
    </>
  );
}
