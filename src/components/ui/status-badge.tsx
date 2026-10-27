import { TONE, label } from "@/lib/format";
import { cn } from "@/lib/utils";

type ToneKey = keyof typeof TONE;

export function StatusBadge({ value, tones, className, text }: { value: string; tones: Record<string, ToneKey>; className?: string; text?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tones[value] ?? "slate"], className)}>
      {text ?? label(value)}
    </span>
  );
}
