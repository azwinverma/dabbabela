import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/labels";

const TONES: Record<Tone, string> = {
  neutral: "bg-ink/5 text-ink-soft ring-ink/15",
  info: "bg-akash-light text-akash ring-akash/30",
  warn: "bg-besar-light text-besar-dark ring-besar/40",
  good: "bg-saag-light text-saag-dark ring-saag/30",
  bad: "bg-sindoor-light text-sindoor-dark ring-sindoor/30",
  brand: "bg-sindoor text-white ring-sindoor",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}
