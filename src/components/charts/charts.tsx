"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS, label } from "@/lib/format";

const axis = { fontSize: 12, fill: "currentColor" } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 },
  itemStyle: { color: "var(--popover-foreground)" },
  labelStyle: { color: "var(--popover-foreground)", fontWeight: 600 },
};

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function MilestoneChart({ data }: { data: { name: string; percent: number; source: "calculated" | "manual"; done: number; total: number }[] }) {
  if (!data.length) return <Empty>No milestones yet. Add one to see completion here.</Empty>;
  return (
    <div role="img" aria-label={`Milestone completion: ${data.map((d) => `${d.name} ${d.percent}%`).join(", ")}`} className="h-full text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" domain={[0, 100]} unit="%" tick={axis} stroke="var(--border)" />
          <YAxis type="category" dataKey="name" width={110} tick={axis} stroke="var(--border)" tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "var(--muted)" }}
            formatter={(value, _n, item) => [`${value}% (${item.payload.done}/${item.payload.total} tasks${item.payload.source === "manual" ? ", manual" : ""})`, "Completion"]}
          />
          <Bar dataKey="percent" name="Completion" isAnimationActive={false} radius={[0, 4, 4, 0]} maxBarSize={22}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.percent >= 100 ? CHART_COLORS.done : CHART_COLORS.actual} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusDonut({ counts }: { counts: Record<"backlog" | "todo" | "in_progress" | "blocked" | "done", number> }) {
  const data = (Object.keys(counts) as (keyof typeof counts)[]).map((k) => ({ key: k, name: label(k), value: counts[k] })).filter((d) => d.value > 0);
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <Empty>No tasks yet. Create tasks to see the distribution.</Empty>;
  return (
    <div role="img" aria-label={`Task status distribution: ${data.map((d) => `${d.name} ${d.value}`).join(", ")}`} className="h-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} isAnimationActive={false} stroke="var(--card)">
            {data.map((d) => (
              <Cell key={d.key} fill={CHART_COLORS[d.key]} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} formatter={(v, n) => [`${v} task${v === 1 ? "" : "s"}`, n]} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BurnupChart({ points, reason }: { points?: { date: string; planned: number; actual: number | null }[]; reason?: string }) {
  if (!points?.length) {
    return <Empty>{reason ? `Not enough data yet. ${reason}` : "Not enough data yet."}</Empty>;
  }
  return (
    <div role="img" aria-label="Planned versus actual completion over time" className="h-full text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points} margin={{ left: -8, right: 12, top: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={axis} stroke="var(--border)" tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
          <YAxis domain={[0, 100]} unit="%" tick={axis} stroke="var(--border)" />
          <Tooltip {...tooltipStyle} formatter={(v) => (v === null || v === undefined ? "—" : `${v}%`)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="planned" isAnimationActive={false} name="Planned (due by date)" stroke={CHART_COLORS.planned} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="actual" isAnimationActive={false} name="Actual (completed)" stroke={CHART_COLORS.actual} strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
