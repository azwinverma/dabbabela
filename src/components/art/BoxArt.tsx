import { cn } from "@/lib/utils";

const ACCENT: Record<string, string> = {
  achar: "#F3DEDA",
  turmeric: "#F9EBCB",
  saag: "#DDE9DE",
  charcoal: "#E7DCC8",
  sindoor: "#F3DEDA",
  besar: "#F9EBCB",
  akash: "#DCE7EF",
  momo: "#F1DDB8",
};

function hash(s: string) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Illustrated top-down tiffin for a box, picked from its name. Used when no photo is uploaded. */
export function BoxArt({ name, accent = "achar", className }: { name: string; accent?: string; className?: string }) {
  const n = name.toLowerCase();
  const h = hash(n);
  const bg = ACCENT[accent] ?? ACCENT.achar;
  const isNoodle = /noodle|chowmein|chow mein|thukpa|pasta/.test(n);
  const isFried = /fried rice|biryani|pulao/.test(n);
  const isRoll = /roll|sekuwa|kebab/.test(n);
  const isKhaja = /khaja|chiura|samay/.test(n);
  const isMomo = /momo/.test(n);
  const hasTikki = /tikki|aloo|potato|spud/.test(n);
  const curry = /chicken|mutton|meat/.test(n) ? "#c46a2b" : /mushroom/.test(n) ? "#8a5a3c" : /paneer/.test(n) ? "#e7a14a" : "#e3b341";
  const tilt = (h % 7) - 3;

  return (
    <svg viewBox="0 0 240 170" className={cn("h-full w-full", className)} role="img" aria-label={name}>
      <rect width="240" height="170" fill={bg} />
      {Array.from({ length: 14 }, (_, i) => (
        <circle key={i} cx={(h * (i + 3) * 13) % 240} cy={(h * (i + 5) * 7) % 170} r={i % 4 === 0 ? 3 : 1.6} fill="#27221D" opacity=".12" />
      ))}
      <g transform={`rotate(${tilt} 120 88)`}>
        <rect x="26" y="22" width="188" height="130" rx="22" fill="#dcd6cc" stroke="#27221D" strokeWidth="4" />
        <rect x="36" y="32" width="168" height="110" rx="15" fill="#FFFCF6" stroke="#27221D" strokeWidth="3" />
        <path d="M120 33v108M120 88h83" stroke="#27221D" strokeWidth="3" />

        {/* left: main base */}
        {isNoodle ? (
          <g fill="none" stroke="#d7a84f" strokeWidth="4" strokeLinecap="round">
            {Array.from({ length: 7 }, (_, i) => (
              <path key={i} d={`M${46 + i * 3} ${50 + i * 12}c12-10 22 10 34 0s22 10 30 0`} />
            ))}
            <circle cx="70" cy="70" r="4" fill="#3B6245" stroke="none" />
            <circle cx="92" cy="104" r="4" fill="#8B2923" stroke="none" />
            <circle cx="60" cy="118" r="3.5" fill="#E3A83B" stroke="none" />
          </g>
        ) : isRoll ? (
          <g stroke="#27221D" strokeWidth="3">
            <rect x="46" y="52" width="66" height="26" rx="13" fill="#e9c27d" transform="rotate(-8 79 65)" />
            <rect x="46" y="96" width="66" height="26" rx="13" fill="#d9a85c" transform="rotate(6 79 109)" />
            <path d="M58 60l6 10M74 58l6 10M90 56l6 10M58 102l6 10M74 104l6 10M90 106l6 10" stroke="#8a5a3c" strokeWidth="2.4" />
          </g>
        ) : isKhaja ? (
          <g stroke="#27221D" strokeWidth="2.6">
            <path d="M44 128c-2-30 6-60 26-72 18-10 40-4 44 14 4 20 2 40 0 58z" fill="#F1DDB8" />
            {Array.from({ length: 22 }, (_, i) => (
              <path key={i} d={`M${54 + ((i * 23) % 52)} ${70 + ((i * 17) % 52)}l5 -2`} stroke="#C9A36A" strokeWidth="2" />
            ))}
          </g>
        ) : isMomo ? (
          <g stroke="#27221D" strokeWidth="2.6">
            {[[60, 62], [92, 62], [60, 104], [92, 104], [76, 83]].map(([x, y], i) => (
              <g key={i}>
                <path d={`M${x - 15} ${y + 10}c-1-12 7-20 15-20s16 8 15 20z`} fill="#FFFCF6" />
                <path d={`M${x} ${y - 10}v20`} fill="none" strokeWidth="1.8" />
              </g>
            ))}
          </g>
        ) : (
          <g>
            <path d="M44 132c-4-34 4-66 22-80 16-12 38-12 46 6 6 18 4 48 2 74z" fill={isFried ? "#efd28f" : "#ffffff"} stroke="#27221D" strokeWidth="3" />
            {Array.from({ length: 16 }, (_, i) => (
              <ellipse key={i} cx={56 + ((i * 29) % 52)} cy={66 + ((i * 19) % 60)} rx="3.6" ry="1.6" fill={isFried ? "#c79a3e" : "#e7e1d6"} />
            ))}
            {isFried && (
              <>
                <circle cx="70" cy="84" r="3.5" fill="#3B6245" />
                <circle cx="88" cy="100" r="3.5" fill="#8B2923" />
                <circle cx="62" cy="112" r="3" fill="#E3A83B" />
                <rect x="80" y="70" width="8" height="6" rx="2" fill="#c46a2b" />
              </>
            )}
          </g>
        )}

        {/* top right: curry / dal */}
        <circle cx="161" cy="60" r="21" fill={curry} stroke="#27221D" strokeWidth="3" />
        <path d="M148 58c8 5 18 5 26-1" fill="none" stroke="#27221D" strokeOpacity=".3" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="168" cy="52" r="2.6" fill="#3B6245" />

        {/* bottom right: side */}
        {hasTikki ? (
          <g stroke="#27221D" strokeWidth="2.6">
            <ellipse cx="146" cy="116" rx="15" ry="11" fill="#d9a04a" />
            <ellipse cx="178" cy="114" rx="15" ry="11" fill="#c98f3c" />
            <path d="M140 112l10 6M172 110l10 6" stroke="#8a5a3c" strokeWidth="2" />
          </g>
        ) : (
          <g stroke="#27221D" strokeWidth="2.4">
            <path d="M134 110c12-10 28-6 32 6-12 8-28 4-32-6z" fill="#3B6245" />
            <rect x="166" y="104" width="16" height="13" rx="4" fill="#E3A83B" />
            <rect x="174" y="120" width="14" height="11" rx="4" fill="#f2c45a" />
            <circle cx="150" cy="126" r="5" fill="#8B2923" />
          </g>
        )}
      </g>
    </svg>
  );
}
