import { cn } from "@/lib/utils";

/**
 * Dabba Bela mark: a two-tier dabba whose domed lid is a clock face with the hands at 12:30 —
 * lunch "bela" (time). Original geometry; see brand/BRAND_GUIDELINES.md.
 */
export function LogoMark({ className, mono = false, title = "Dabba Bela" }: { className?: string; mono?: boolean; title?: string }) {
  const red = mono ? "currentColor" : "#8B2923";
  const gold = mono ? "none" : "#E3A83B";
  const ink = mono ? "currentColor" : "#27221D";
  const cream = mono ? "currentColor" : "#F5EBD6";
  return (
    <svg viewBox="0 0 64 64" className={cn("shrink-0", className)} role="img" aria-label={title}>
      <title>{title}</title>
      {/* knob */}
      <rect x="28.5" y="6" width="7" height="5" rx="2" fill={ink} />
      {/* domed lid = clock face */}
      <path d="M10 31a22 22 0 0 1 44 0z" fill={gold} stroke={ink} strokeWidth="3" strokeLinejoin="round" />
      {/* clock ticks */}
      <path d="M32 13.5v3M17 23l2.2 1.7M47 23l-2.2 1.7" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
      {/* hands at 12:30 */}
      <path d="M32 29V18.5M32 29l6.5 0" stroke={ink} strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="29" r="2.4" fill={ink} />
      {/* two-tier body */}
      <rect x="9" y="33" width="46" height="25" rx="6" fill={red} stroke={ink} strokeWidth="3" />
      <path d="M9.5 45.5h45" stroke={mono ? "none" : cream} strokeWidth="2.4" />
      {mono && <path d="M9.5 45.5h45" stroke="#fff" strokeOpacity=".0" />}
      {/* side clasp */}
      <rect x="27" y="41.5" width="10" height="8" rx="2" fill={cream} stroke={ink} strokeWidth="2.2" />
    </svg>
  );
}

export function Logo({ className, light = false, showNepali = true, size = "md" }: { className?: string; light?: boolean; showNepali?: boolean; size?: "sm" | "md" | "lg" }) {
  const mark = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const word = size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-[1.4rem]";
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={mark} />
      <span className="flex flex-col leading-none">
        <span className={cn("font-display font-extrabold tracking-[-0.03em]", word, light ? "text-paper" : "text-ink")}>
          Dabba<span className={light ? "text-besar" : "text-sindoor"}> Bela</span>
        </span>
        {showNepali && <span className={cn("lang-ne mt-0.5 text-[0.7rem] font-semibold tracking-wide", light ? "text-paper/70" : "text-ink-mute")}>डब्बा बेला</span>}
      </span>
    </span>
  );
}
