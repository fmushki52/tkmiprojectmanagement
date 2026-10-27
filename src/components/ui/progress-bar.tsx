import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  className,
  color,
  label,
  size = "md",
}: {
  value: number;
  className?: string;
  color?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label ?? "Progress"}
      className={cn("w-full overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2", className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%`, ...(color ? { backgroundColor: color } : {}) }} />
    </div>
  );
}
