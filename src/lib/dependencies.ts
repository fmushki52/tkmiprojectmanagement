export interface DependencyEdge {
  /** The task that must wait. */
  taskId: string;
  /** The task it waits for. */
  dependsOnTaskId: string;
}

/**
 * True if making `taskId` depend on each of `newDependsOn` would create a cycle in the dependency
 * graph (including a task depending on itself). `existing` is the current edge set of the project.
 */
export function wouldCreateCycle(existing: DependencyEdge[], taskId: string, newDependsOn: string[]): boolean {
  if (newDependsOn.includes(taskId)) return true;
  // Existing edges of OTHER tasks plus the proposed edges for this one.
  const next = new Map<string, string[]>();
  for (const e of existing) {
    if (e.taskId === taskId) continue;
    next.set(e.taskId, [...(next.get(e.taskId) ?? []), e.dependsOnTaskId]);
  }
  next.set(taskId, newDependsOn);
  // A cycle exists iff taskId is reachable from its own dependencies.
  const seen = new Set<string>();
  const stack = [...newDependsOn];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

/** Order for a Kanban drop: the position between the neighbours at `index` in the target column. */
export function positionAtIndex(columnPositions: number[], index: number): number {
  const sorted = [...columnPositions].sort((a, b) => a - b);
  const i = Math.max(0, Math.min(index, sorted.length));
  if (sorted.length === 0) return 1024;
  if (i === 0) return sorted[0] - 1024;
  if (i === sorted.length) return sorted[sorted.length - 1] + 1024;
  return (sorted[i - 1] + sorted[i]) / 2;
}
