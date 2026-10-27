"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, LayoutList, Columns3, Plus, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { positionAtIndex } from "@/lib/dependencies";
import { addDaysISO, formatDate, todayISO } from "@/lib/dates";
import { PRIORITY_TONE, TASK_STATUS_TONE, label } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PRIORITIES, TASK_STATUSES } from "@/lib/validation";
import { moveTaskAction, quickCreateTaskAction } from "./actions";
import { TaskDetailSheet } from "./task-detail";
import { TaskForm } from "./task-form";
import type { Option, TaskItem } from "./types";

type Status = (typeof TASK_STATUSES)[number];
interface Perms {
  update: boolean;
  create: boolean;
  delete: boolean;
  comment: boolean;
  moderate: boolean;
  attach: boolean;
}

const byPosition = (a: TaskItem, b: TaskItem) => a.position - b.position;

function Card({ task, dragging, onOpen, today }: { task: TaskItem; dragging?: boolean; onOpen?: () => void; today: string }) {
  const overdue = task.status !== "done" && task.dueDate && task.dueDate < today;
  return (
    <div className={cn("rounded-lg border bg-card p-3 text-sm shadow-xs", dragging && "shadow-lg ring-2 ring-primary/40")}>
      <button type="button" onClick={onOpen} className="block w-full text-left font-medium hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        {task.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge value={task.priority} tones={PRIORITY_TONE} />
        {task.labels.slice(0, 2).map((l) => (
          <span key={l} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{l}</span>
        ))}
        {task.hasSubtasks ? <span className="text-xs text-muted-foreground">has subtasks</span> : null}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className={cn("flex items-center gap-1", overdue && "font-medium text-destructive")}>
          <CalendarDays className="size-3.5" />
          {task.dueDate ? `${overdue ? "Overdue · " : ""}${formatDate(task.dueDate, "MMM d")}` : "No date"}
        </span>
        <span className="truncate pl-2">{task.assigneeName ?? "Unassigned"}</span>
      </div>
    </div>
  );
}

function SortableCard({ task, onOpen, today, disabled }: { task: TaskItem; onOpen: () => void; today: string; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { type: "task", status: task.status }, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("group relative", isDragging && "opacity-40")}>
      {!disabled ? (
        <button
          type="button"
          aria-label={`Reorder ${task.title}. Press space to pick up, arrow keys to move.`}
          className="absolute top-2 right-1.5 z-10 rounded p-1 text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : null}
      <Card task={task} onOpen={onOpen} today={today} />
    </div>
  );
}

function Column({ status, tasks, children }: { status: Status; tasks: TaskItem[]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { type: "column", status } });
  return (
    <section aria-label={`${label(status)} column`} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 p-2">
      <header className="mb-2 flex items-center gap-2 px-1.5 text-sm font-medium">
        <StatusBadge value={status} tones={TASK_STATUS_TONE} />
        <span className="text-muted-foreground">{tasks.length}</span>
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-2 rounded-lg p-0.5 transition-colors", isOver && "bg-primary/5")}>
        {children}
      </div>
    </section>
  );
}

export function TasksPanel({
  projectId,
  tasks,
  milestones,
  people,
  currentUserId,
  perms,
  leafIds,
}: {
  projectId: string;
  tasks: TaskItem[];
  milestones: Option[];
  people: Option[];
  currentUserId: string;
  perms: Perms;
  leafIds: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todayISO();

  // Optimistic copy of the server data so a drop feels instant; re-synced after every refresh.
  const [items, setItems] = useState(tasks);
  useEffect(() => setItems(tasks), [tasks]);

  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [due, setDue] = useState("");
  const [sort, setSort] = useState<{ key: "title" | "status" | "priority" | "assignee" | "due"; dir: 1 | -1 }>({ key: "due", dir: 1 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickMilestone, setQuickMilestone] = useState("");
  const [quickPending, setQuickPending] = useState(false);

  const openId = params.get("task");
  const openTask = items.find((t) => t.id === openId) ?? null;
  function openTaskById(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("task", id);
    else next.delete("task");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const filtersActive = !!(q || assignee || priority || status || due);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((t) => {
      if (term && !t.title.toLowerCase().includes(term) && !t.description.toLowerCase().includes(term)) return false;
      if (assignee === "unassigned" ? t.assigneeId : assignee && t.assigneeId !== assignee) return false;
      if (priority && t.priority !== priority) return false;
      if (status && t.status !== status) return false;
      if (due === "overdue" && !(t.status !== "done" && t.dueDate && t.dueDate < today)) return false;
      if (due === "week" && !(t.status !== "done" && t.dueDate && t.dueDate >= today && t.dueDate <= addDaysISO(today, 7))) return false;
      if (due === "none" && t.dueDate) return false;
      return true;
    });
  }, [items, q, assignee, priority, status, due, today]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !perms.update) return;
    const moving = items.find((t) => t.id === active.id);
    if (!moving) return;
    const overData = over.data.current as { type: "task" | "column"; status: Status } | undefined;
    if (!overData) return;
    const target = overData.status;
    // The index is computed against the persisted (unfiltered) column so the server order stays meaningful.
    const fullColumn = items.filter((t) => t.status === target).sort(byPosition);
    const column = fullColumn.filter((t) => t.id !== moving.id);
    const origIdx = fullColumn.findIndex((t) => t.id === moving.id); // -1 when coming from another column
    let index = column.length;
    if (overData.type === "task") {
      if (over.id === moving.id) return;
      const overIdx = column.findIndex((t) => t.id === over.id);
      const overFullIdx = fullColumn.findIndex((t) => t.id === over.id);
      index = overIdx + (origIdx !== -1 && origIdx < overFullIdx ? 1 : 0);
    }
    if (origIdx !== -1 && index === origIdx) return;

    const before = items;
    const position = positionAtIndex(column.map((t) => t.position), index);
    setItems(items.map((t) => (t.id === moving.id ? { ...t, status: target, position } : t)));
    const res = await moveTaskAction(moving.id, target, index);
    if (!res.ok) {
      setItems(before);
      toast.error(res.error);
    } else {
      router.refresh();
    }
  }

  async function changeStatus(task: TaskItem, next: Status) {
    const before = items;
    setItems(items.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    const res = await moveTaskAction(task.id, next, 10_000);
    if (!res.ok) {
      setItems(before);
      toast.error(res.error);
    } else {
      toast.success("Status updated");
      router.refresh();
    }
  }

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setQuickPending(true);
    const res = await quickCreateTaskAction(projectId, { title: quickTitle, milestoneId: quickMilestone, status: "todo" });
    setQuickPending(false);
    if (!res.ok) return void toast.error(res.error);
    setQuickTitle("");
    toast.success("Task added");
    router.refresh();
  }

  const sorted = useMemo(() => {
    const rank = (t: TaskItem) => ({ title: t.title.toLowerCase(), status: TASK_STATUSES.indexOf(t.status), priority: PRIORITIES.indexOf(t.priority), assignee: (t.assigneeName ?? "~").toLowerCase(), due: t.dueDate ?? "9999-99-99" })[sort.key];
    return [...filtered].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0) * sort.dir);
  }, [filtered, sort]);

  const otherTasks = items.map((t) => ({ id: t.id, title: t.title, parentTaskId: t.parentTaskId }));
  const activeTask = items.find((t) => t.id === activeId) ?? null;
  const leaf = new Set(leafIds);
  const th = (key: typeof sort.key, text: string) => (
    <th scope="col" className="px-3 py-2 text-left font-medium" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}>
        {text}
        {sort.key === key ? <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="View">
          <Button variant={view === "board" ? "secondary" : "ghost"} size="sm" aria-pressed={view === "board"} onClick={() => setView("board")}>
            <Columns3 /> Board
          </Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" aria-pressed={view === "list"} onClick={() => setView("list")}>
            <LayoutList /> List
          </Button>
        </div>
        <div className="relative min-w-44 flex-1 sm:max-w-56">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search tasks" placeholder="Search tasks…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Filter by assignee" className="w-40" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">All assignees</option>
          <option value={currentUserId}>Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {people.filter((p) => p.id !== currentUserId).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by priority" className="w-36" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (<option key={p} value={p}>{label(p)}</option>))}
        </NativeSelect>
        {view === "list" ? (
          <NativeSelect aria-label="Filter by status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}
          </NativeSelect>
        ) : null}
        <NativeSelect aria-label="Filter by due date" className="w-36" value={due} onChange={(e) => setDue(e.target.value)}>
          <option value="">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due this week</option>
          <option value="none">No due date</option>
        </NativeSelect>
        {filtersActive ? (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setAssignee(""); setPriority(""); setStatus(""); setDue(""); }}>Clear filters</Button>
        ) : null}
        {perms.create ? (
          <Button size="sm" className="ml-auto" onClick={() => setNewOpen(true)}>
            <Plus /> New task
          </Button>
        ) : null}
      </div>

      {perms.create ? (
        <form onSubmit={quickAdd} className="flex flex-wrap gap-2" aria-label="Quick add task">
          <Input aria-label="Quick add task title" placeholder="Quick add: type a task title and press Enter" className="min-w-52 flex-1" value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} />
          <NativeSelect aria-label="Milestone for quick add" className="w-48" value={quickMilestone} onChange={(e) => setQuickMilestone(e.target.value)}>
            <option value="">No milestone</option>
            {milestones.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
          </NativeSelect>
          <Button type="submit" variant="secondary" disabled={quickPending || !quickTitle.trim()}>Add</Button>
        </form>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No tasks yet. {perms.create ? "Use quick add above to create the first one." : ""}
        </div>
      ) : view === "board" ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="flex gap-3 overflow-x-auto pb-2" role="list" aria-label="Kanban board">
            {TASK_STATUSES.map((s) => {
              const col = filtered.filter((t) => t.status === s).sort(byPosition);
              return (
                <Column key={s} status={s} tasks={col}>
                  <SortableContext items={col.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    {col.map((t) => (
                      <SortableCard key={t.id} task={t} today={today} disabled={!perms.update} onOpen={() => openTaskById(t.id)} />
                    ))}
                  </SortableContext>
                  {col.length === 0 ? <p className="px-2 py-4 text-center text-xs text-muted-foreground">{perms.update ? "Drop tasks here" : "No tasks"}</p> : null}
                </Column>
              );
            })}
          </div>
          <DragOverlay>{activeTask ? <Card task={activeTask} dragging today={today} /> : null}</DragOverlay>
        </DndContext>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {th("title", "Task")}
                {th("status", "Status")}
                {th("priority", "Priority")}
                {th("assignee", "Assignee")}
                <th scope="col" className="px-3 py-2 text-left font-medium">Milestone</th>
                {th("due", "Due")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const overdue = t.status !== "done" && t.dueDate && t.dueDate < today;
                return (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="max-w-80 px-3 py-2">
                      <button type="button" className={cn("truncate text-left font-medium hover:underline", t.parentTaskId && "pl-4")} onClick={() => openTaskById(t.id)}>
                        {t.title}
                      </button>
                      {t.hasSubtasks || !leaf.has(t.id) ? <span className="ml-2 text-xs text-muted-foreground">(parent)</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {perms.update ? (
                        <NativeSelect aria-label={`Status of ${t.title}`} className="h-7 w-32" value={t.status} onChange={(e) => changeStatus(t, e.target.value as Status)}>
                          {TASK_STATUSES.map((s) => (<option key={s} value={s}>{label(s)}</option>))}
                        </NativeSelect>
                      ) : (
                        <StatusBadge value={t.status} tones={TASK_STATUS_TONE} />
                      )}
                    </td>
                    <td className="px-3 py-2"><StatusBadge value={t.priority} tones={PRIORITY_TONE} /></td>
                    <td className="px-3 py-2">{t.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.milestoneTitle ?? "—"}</td>
                    <td className={cn("px-3 py-2 whitespace-nowrap", overdue && "font-medium text-destructive")}>{t.dueDate ? `${overdue ? "Overdue · " : ""}${formatDate(t.dueDate, "MMM d, yyyy")}` : "—"}</td>
                  </tr>
                );
              })}
              {sorted.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No tasks match your filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtered.length} of {items.length} task{items.length === 1 ? "" : "s"}
        {view === "board" && perms.update ? " · drag cards between columns (or use the grip handle with the keyboard)" : ""}
      </p>

      <TaskDetailSheet
        task={openTask}
        onClose={() => openTaskById(null)}
        projectId={projectId}
        milestones={milestones}
        people={people}
        otherTasks={otherTasks}
        currentUserId={currentUserId}
        perms={perms}
        onOpenTask={(id) => openTaskById(id)}
      />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>Add an actionable task. Progress rolls up to its milestone and the project.</DialogDescription>
          </DialogHeader>
          <TaskForm
            projectId={projectId}
            milestones={milestones}
            people={people}
            otherTasks={otherTasks}
            onSaved={() => {
              setNewOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
