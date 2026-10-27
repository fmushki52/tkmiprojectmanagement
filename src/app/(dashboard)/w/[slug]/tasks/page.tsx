import { CheckSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, todayISO } from "@/lib/dates";
import { PRIORITY_TONE, TASK_STATUS_TONE, label } from "@/lib/format";
import { PRIORITIES, TASK_STATUSES } from "@/lib/validation";
import { getWorkspaceCtx } from "@/server/context";
import { listTasks, type TaskFilter } from "@/server/services/tasks";

export const metadata: Metadata = { title: "My Tasks" };

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => ((allowed as readonly string[]).includes(v ?? "") ? (v as T) : undefined);

export default async function MyTasksPage({ params, searchParams }: PageProps<"/w/[slug]/tasks">) {
  const { slug } = await params;
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;
  const ws = await getWorkspaceCtx(slug);
  const today = todayISO();
  const filter: TaskFilter = {
    assigneeId: ws.userId,
    status: pick(one("status"), [...TASK_STATUSES, "open"] as const) ?? "open",
    priority: pick(one("priority"), PRIORITIES),
    due: pick(one("due"), ["overdue", "week", "none"] as const),
    q: one("q"),
    sort: pick(one("sort"), ["due", "priority", "status", "title", "updated"] as const) ?? "due",
  };
  const rows = await listTasks(ws, filter, today);
  const status = filter.status ?? "open";

  return (
    <>
      <PageHeader title="My Tasks" description="Tasks assigned to you across all projects in this workspace." />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filter my tasks">
        <input name="q" defaultValue={one("q") ?? ""} placeholder="Search…" aria-label="Search my tasks" className="h-8 w-48 rounded-lg border border-input bg-transparent px-2.5 text-sm" />
        <NativeSelect name="status" aria-label="Status" className="w-36" defaultValue={status}>
          <option value="open">Open</option>
          {TASK_STATUSES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}
        </NativeSelect>
        <NativeSelect name="priority" aria-label="Priority" className="w-36" defaultValue={filter.priority ?? ""}>
          <option value="">Any priority</option>
          {PRIORITIES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}
        </NativeSelect>
        <NativeSelect name="due" aria-label="Due date" className="w-36" defaultValue={filter.due ?? ""}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due this week</option>
          <option value="none">No due date</option>
        </NativeSelect>
        <NativeSelect name="sort" aria-label="Sort" className="w-36" defaultValue={filter.sort}>
          <option value="due">Due date</option>
          <option value="priority">Priority</option>
          <option value="status">Status</option>
          <option value="title">Title</option>
          <option value="updated">Recently updated</option>
        </NativeSelect>
        <Button type="submit" variant="secondary" size="sm">Apply</Button>
        <Link href={`/w/${slug}/tasks`} className="text-sm text-muted-foreground hover:underline">Reset</Link>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon={<CheckSquare />} title="No tasks found" description="Tasks assigned to you will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Task</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Project</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Priority</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task, projectTitle, projectColor }) => {
                const overdue = task.status !== "done" && task.dueDate && task.dueDate < today;
                return (
                  <tr key={task.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="max-w-80 px-3 py-2">
                      <Link className="font-medium hover:underline" href={`/w/${slug}/projects/${task.projectId}?tab=tasks&task=${task.id}`}>{task.title}</Link>
                    </td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: projectColor }} />{projectTitle}</span></td>
                    <td className="px-3 py-2"><StatusBadge value={task.status} tones={TASK_STATUS_TONE} /></td>
                    <td className="px-3 py-2"><StatusBadge value={task.priority} tones={PRIORITY_TONE} /></td>
                    <td className={`px-3 py-2 whitespace-nowrap ${overdue ? "font-medium text-destructive" : ""}`}>{task.dueDate ? `${overdue ? "Overdue · " : ""}${formatDate(task.dueDate)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
