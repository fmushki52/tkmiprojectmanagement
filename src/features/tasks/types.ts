import type { TaskRow } from "@/server/services/tasks";

/** Serializable task row passed from server components to the tasks UI. */
export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: TaskRow["status"];
  priority: TaskRow["priority"];
  assigneeId: string | null;
  assigneeName: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  parentTaskId: string | null;
  hasSubtasks: boolean;
  startDate: string | null;
  dueDate: string | null;
  estimateHours: string | null;
  actualHours: string | null;
  progress: number | null;
  position: number;
  labels: string[];
  projectId: string;
  projectTitle?: string;
  projectColor?: string;
}

export interface Option {
  id: string;
  name: string;
}
