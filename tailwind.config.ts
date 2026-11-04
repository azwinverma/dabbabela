import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "1rem", md: "1.5rem" }, screens: { "2xl": "1240px" } },
    extend: {
      colors: {
        // Dabba Bela palette (docs: brand/BRAND_GUIDELINES.md). Legacy names kept as aliases.
        ink: { DEFAULT: "#27221D", soft: "#4A423A", mute: "#776B5E", line: "#E2D3B5" },
        paper: { DEFAULT: "#F5EBD6", deep: "#ECDDBF", card: "#FFFCF6" },
        sindoor: { DEFAULT: "#8B2923", dark: "#6C1F1A", light: "#F3DEDA" },
        besar: { DEFAULT: "#E3A83B", dark: "#B47F1E", light: "#F9EBCB" },
        saag: { DEFAULT: "#3B6245", dark: "#2B4833", light: "#DDE9DE" },
        akash: { DEFAULT: "#2F5D7C", light: "#DCE7EF" },
        momo: "#F1DDB8",
        achar: { DEFAULT: "#8B2923", dark: "#6C1F1A", light: "#F3DEDA" },
        turmeric: { DEFAULT: "#E3A83B", dark: "#B47F1E", light: "#F9EBCB" },
        charcoal: { DEFAULT: "#27221D", soft: "#4A423A" },
        cream: { DEFAULT: "#F5EBD6", deep: "#ECDDBF" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        marker: ["var(--font-marker)", "cursive"],
        deva: ["var(--font-deva)", "var(--font-body)", "sans-serif"],
      },
      boxShadow: {
        sticker: "4px 4px 0 0 #27221D",
        "sticker-sm": "2px 2px 0 0 #27221D",
        "sticker-lg": "6px 6px 0 0 #27221D",
        card: "0 1px 0 rgba(39,34,29,.05), 0 10px 30px -14px rgba(39,34,29,.22)",
      },
      borderRadius: { blob: "42% 58% 63% 37% / 41% 44% 56% 59%" },
      keyframes: {
        drip: { "0%": { transform: "scaleY(0)" }, "100%": { transform: "scaleY(1)" } },
        wobble: { "0%,100%": { transform: "rotate(-2deg)" }, "50%": { transform: "rotate(2deg)" } },
        steam: { "0%": { opacity: "0", transform: "translateY(6px)" }, "50%": { opacity: ".9" }, "100%": { opacity: "0", transform: "translateY(-10px)" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
      },
      animation: {
        drip: "drip .9s cubic-bezier(.2,.8,.2,1) both",
        wobble: "wobble 5s ease-in-out infinite",
        steam: "steam 2.6s ease-in-out infinite",
        marquee: "marquee 38s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
