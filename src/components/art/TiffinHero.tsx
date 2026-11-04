import { cn } from "@/lib/utils";

/** Big hero illustration: an opened steel tiffin with dal-bhat, spray halo and steam. */
export function TiffinHero({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 480" className={cn("h-auto w-full", className)} role="img" aria-label="An open tiffin box with dal, rice, tarkari and achar">
      <defs>
        <radialGradient id="halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E3A83B" stopOpacity=".95" />
          <stop offset="62%" stopColor="#E3A83B" stopOpacity=".55" />
          <stop offset="100%" stopColor="#E3A83B" stopOpacity="0" />
        </radialGradient>
        <pattern id="steel" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <rect width="6" height="6" fill="#dcd6cc" />
          <rect width="2" height="6" fill="#e9e4dc" />
        </pattern>
      </defs>

      {/* spray halo */}
      <circle cx="270" cy="250" r="225" fill="url(#halo)" />
      {Array.from({ length: 40 }, (_, i) => {
        const a = (i * 47) % 360;
        const r = 205 + ((i * 29) % 40);
        return (
          <circle key={i} cx={(270 + Math.cos((a * Math.PI) / 180) * r).toFixed(1)} cy={(250 + Math.sin((a * Math.PI) / 180) * r).toFixed(1)} r={i % 5 === 0 ? 4 : 2} fill="#E3A83B" />
        );
      })}

      {/* steam */}
      <g fill="none" stroke="#27221D" strokeWidth="4" strokeLinecap="round">
        <path className="animate-steam" d="M210 120c-14-18 14-26 0-46" />
        <path className="animate-steam [animation-delay:.6s]" d="M262 108c-14-18 14-26 0-46" />
        <path className="animate-steam [animation-delay:1.2s]" d="M314 120c-14-18 14-26 0-46" />
      </g>

      {/* lid leaning behind */}
      <g transform="rotate(-14 410 220)">
        <ellipse cx="420" cy="230" rx="70" ry="88" fill="url(#steel)" stroke="#27221D" strokeWidth="5" />
        <ellipse cx="420" cy="230" rx="44" ry="58" fill="none" stroke="#27221D" strokeWidth="3" opacity=".35" />
        <rect x="402" y="140" width="36" height="14" rx="7" fill="#27221D" />
      </g>

      {/* tiffin body */}
      <rect x="90" y="150" width="340" height="250" rx="36" fill="url(#steel)" stroke="#27221D" strokeWidth="6" />
      <rect x="108" y="168" width="304" height="214" rx="24" fill="#FFFCF6" stroke="#27221D" strokeWidth="4" />
      <path d="M262 170v210M262 274h148" stroke="#27221D" strokeWidth="4" />

      {/* rice */}
      <path d="M128 360c-8-40 4-80 30-104 20-18 52-26 76-8 22 16 26 52 22 112z" fill="#ffffff" stroke="#27221D" strokeWidth="3.5" />
      {Array.from({ length: 22 }, (_, i) => (
        <ellipse key={i} cx={150 + ((i * 37) % 96)} cy={270 + ((i * 23) % 80)} rx="4.5" ry="2" transform={`rotate(${(i * 40) % 180} ${150 + ((i * 37) % 96)} ${270 + ((i * 23) % 80)})`} fill="#e7e1d6" />
      ))}
      {/* ghee drop */}
      <ellipse cx="190" cy="262" rx="10" ry="5" fill="#E3A83B" opacity=".8" />

      {/* dal bowl */}
      <circle cx="336" cy="222" r="44" fill="#e3b341" stroke="#27221D" strokeWidth="4" />
      <path d="M306 214c10 8 24 10 40 2M318 236c10 4 22 4 32-2" fill="none" stroke="#B47F1E" strokeWidth="3" strokeLinecap="round" />
      <circle cx="352" cy="206" r="4" fill="#3B6245" />
      <circle cx="322" cy="228" r="3" fill="#3B6245" />

      {/* tarkari */}
      <g stroke="#27221D" strokeWidth="3">
        <rect x="284" y="296" width="26" height="22" rx="6" fill="#E3A83B" transform="rotate(-12 297 307)" />
        <rect x="318" y="306" width="24" height="20" rx="6" fill="#f2c45a" transform="rotate(18 330 316)" />
        <path d="M352 294c14-6 30 0 34 12-12 6-28 2-34-12z" fill="#3B6245" />
        <rect x="292" y="330" width="24" height="20" rx="6" fill="#f2c45a" transform="rotate(8 304 340)" />
        <path d="M330 340c12-8 30-4 36 8-12 8-30 4-36-8z" fill="#3f8a4c" />
        <circle cx="384" cy="336" r="9" fill="#8B2923" />
      </g>

      {/* achar */}
      <circle cx="200" cy="198" r="22" fill="#8B2923" stroke="#27221D" strokeWidth="3.5" />
      <path d="M190 192l6 4M204 188l4 7M196 206l8-2" stroke="#FFFCF6" strokeWidth="2.5" strokeLinecap="round" />

      {/* chili */}
      <g transform="translate(70 380) rotate(-18)">
        <path d="M12 18c10 14 40 18 58 6 4-3 2-8-3-6-16 6-34 4-46-6z" fill="#8B2923" stroke="#27221D" strokeWidth="3" strokeLinejoin="round" />
        <path d="M12 18c-3-4-4-8-1-11 3 2 5 5 5 9" fill="#3B6245" stroke="#27221D" strokeWidth="3" strokeLinejoin="round" />
      </g>

      {/* drips off the tin */}
      <path d="M150 398v26a7 7 0 0 0 14 0v-26zM360 398v40a7 7 0 0 0 14 0v-40z" fill="#8B2923" stroke="#27221D" strokeWidth="3" />
    </svg>
  );
}
