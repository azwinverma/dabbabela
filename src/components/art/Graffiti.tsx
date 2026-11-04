import { cn } from "@/lib/utils";

const COLORS = { sindoor: "#8B2923", besar: "#E3A83B", saag: "#3B6245", ink: "#27221D", paper: "#F5EBD6", akash: "#2F5D7C", card: "#FFFCF6", achar: "#8B2923", turmeric: "#E3A83B" } as const;
export type ArtColor = keyof typeof COLORS;

/** Paint drips hanging from the top edge of a section. */
export function Drips({ color = "sindoor", className }: { color?: ArtColor; className?: string }) {
  const c = COLORS[color];
  return (
    <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className={cn("block h-10 w-full", className)} aria-hidden>
      <path
        fill={c}
        d="M0 0h1200v14c-22 0-26 6-30 18-3 9-12 9-14 0-3-12-9-18-30-18-40 0-62 3-80 4-14 1-16 30-22 30s-8-29-20-30c-60-3-90 2-140 3-12 0-12 18-17 18s-6-18-17-18H700c-19 0-22 38-29 38s-9-38-28-38c-45 0-80-1-128 0-15 0-17 11-22 11s-7-11-20-11H340c-16 0-19 26-25 26s-8-26-24-26c-40 0-70-2-100 0-11 1-13 13-17 13s-6-13-17-13H70c-13 0-15 20-20 20S43 14 30 14H0z"
      />
    </svg>
  );
}

/** Marker scribble underline. */
export function Scribble({ color = "besar", className }: { color?: ArtColor; className?: string }) {
  return (
    <svg viewBox="0 0 300 24" preserveAspectRatio="none" className={cn("h-3 w-full", className)} aria-hidden>
      <path d="M4 15c48-9 120-12 190-8 34 2 66 5 100 2M24 20c60-6 140-8 240-4" fill="none" stroke={COLORS[color]} strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function Arrow({ className, color = "ink" }: { className?: string; color?: ArtColor }) {
  return (
    <svg viewBox="0 0 120 70" className={cn("h-12 w-20", className)} aria-hidden>
      <path d="M6 12c20 40 60 52 98 40" fill="none" stroke={COLORS[color]} strokeWidth="4" strokeLinecap="round" />
      <path d="M90 38l16 13-19 8" fill="none" stroke={COLORS[color]} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Spray splatter dots — deterministic so SSR/CSR match. */
export function Splatter({ color = "besar", className, seed = 3 }: { color?: ArtColor; className?: string; seed?: number }) {
  const dots = Array.from({ length: 26 }, (_, i) => {
    const a = (i * 137.5 + seed * 31) % 360;
    const r = 8 + ((i * 53 + seed * 17) % 42);
    const x = 50 + Math.cos((a * Math.PI) / 180) * r;
    const y = 50 + Math.sin((a * Math.PI) / 180) * r;
    const s = i % 7 === 0 ? 4.5 : i % 3 === 0 ? 2.4 : 1.3;
    return { x, y, s };
  });
  return (
    <svg viewBox="0 0 100 100" className={cn("h-24 w-24", className)} aria-hidden>
      <circle cx="50" cy="50" r="14" fill={COLORS[color]} opacity=".9" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x.toFixed(2)} cy={d.y.toFixed(2)} r={d.s} fill={COLORS[color]} />
      ))}
    </svg>
  );
}

/** Round sticker with a jagged edge. */
export function Starburst({ children, className, color = "besar" }: { children: React.ReactNode; className?: string; color?: ArtColor }) {
  const pts = Array.from({ length: 28 }, (_, i) => {
    const r = i % 2 === 0 ? 50 : 43;
    const a = (i / 28) * Math.PI * 2;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <span className={cn(!className?.includes("absolute") && "relative", "inline-grid h-28 w-28 place-items-center", className)}>
      <svg viewBox="-4 -4 108 108" className="absolute inset-0 h-full w-full" aria-hidden>
        <polygon points={pts} fill={COLORS[color]} stroke={COLORS.ink} strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <span className="relative px-3 text-center font-marker text-sm leading-tight text-ink">{children}</span>
    </span>
  );
}

/** Lungta — prayer flags strung across. */
export function PrayerFlags({ className }: { className?: string }) {
  const flags = ["#2F5D7C", "#FFFCF6", "#8B2923", "#3B6245", "#E3A83B"];
  return (
    <svg viewBox="0 0 400 60" className={cn("h-10 w-full", className)} preserveAspectRatio="none" aria-hidden>
      <path d="M0 6 Q200 40 400 6" fill="none" stroke="#27221D" strokeWidth="1.6" />
      {Array.from({ length: 15 }, (_, i) => {
        const x = 10 + i * 26.5;
        const t = x / 400;
        const y = 6 + 34 * 4 * t * (1 - t) * 0.82;
        return (
          <path
            key={i}
            d={`M${x} ${y} l18 ${1.5} l-1 18 l-17 -1.5z`}
            fill={flags[i % 5]}
            stroke="#27221D"
            strokeWidth="1.2"
            transform={`rotate(${(i % 3) - 1} ${x} ${y})`}
          />
        );
      })}
    </svg>
  );
}

export function Chili({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 40" className={cn("h-8 w-16", className)} aria-hidden>
      <path d="M12 18c10 14 40 18 58 6 4-3 2-8-3-6-16 6-34 4-46-6z" fill="#8B2923" stroke="#27221D" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M12 18c-3-4-4-8-1-11 3 2 5 5 5 9" fill="#3B6245" stroke="#27221D" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Momo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 70 54" className={cn("h-10 w-12", className)} aria-hidden>
      <path d="M6 44c-2-16 12-30 29-30s31 14 29 30z" fill="#FFFCF6" stroke="#27221D" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M35 14c-2 8-2 16 0 30M22 20c2 6 4 14 4 24M48 20c-2 6-4 14-4 24" fill="none" stroke="#27221D" strokeWidth="2" strokeLinecap="round" />
      <path d="M31 10c0-5 8-5 8 0" fill="none" stroke="#27221D" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Leaf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 50 50" className={cn("h-8 w-8", className)} aria-hidden>
      <path d="M8 42C6 20 22 6 44 6c0 22-14 38-36 36z" fill="#3B6245" stroke="#27221D" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M10 40C20 28 28 20 38 12" fill="none" stroke="#FFFCF6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Courier on a scooter — Kathmandu style. */
export function Rider({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 110" className={cn("h-24 w-36", className)} aria-hidden>
      <circle cx="36" cy="88" r="15" fill="#FFFCF6" stroke="#27221D" strokeWidth="4" />
      <circle cx="122" cy="88" r="15" fill="#FFFCF6" stroke="#27221D" strokeWidth="4" />
      <path d="M36 88h30l14-26h28l14 26" fill="none" stroke="#27221D" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M58 70c0-10 8-16 18-16h20c10 0 18 8 20 18l2 10H64z" fill="#8B2923" stroke="#27221D" strokeWidth="3.5" strokeLinejoin="round" />
      <rect x="14" y="46" width="34" height="30" rx="5" fill="#E3A83B" stroke="#27221D" strokeWidth="3.5" />
      <path d="M20 58h22" stroke="#27221D" strokeWidth="3" strokeLinecap="round" />
      <circle cx="96" cy="22" r="11" fill="#3B6245" stroke="#27221D" strokeWidth="3.5" />
      <path d="M96 33l-6 22h16M110 40l16 4" fill="none" stroke="#27221D" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 74h10M4 64h8M0 84h8" stroke="#27221D" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Himalaya skyline line. */
export function Mountains({ className, color = "ink" }: { className?: string; color?: ArtColor }) {
  return (
    <svg viewBox="0 0 600 90" preserveAspectRatio="none" className={cn("h-16 w-full", className)} aria-hidden>
      <path
        d="M0 90 L60 50 L95 66 L150 18 L190 48 L230 30 L290 70 L340 10 L380 42 L420 28 L470 64 L520 36 L600 80 V90Z"
        fill="none"
        stroke={COLORS[color]}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M140 28 L150 18 L160 30 M330 22 L340 10 L352 24" fill="none" stroke={COLORS[color]} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

/** SVG filter that roughens edges for spray-painted text (rendered once in the root layout). */
export function RoughFilter() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <filter id="rough">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" />
      </filter>
    </svg>
  );
}
