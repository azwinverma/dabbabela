import { ImageResponse } from "next/og";

export const alt = "Dabba Bela — home-style lunch delivered across Kathmandu";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#F5EBD6", padding: 70, flexDirection: "column", justifyContent: "space-between", borderBottom: "22px solid #8B2923" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="110" height="110" viewBox="0 0 64 64">
            <rect x="28.5" y="6" width="7" height="5" rx="2" fill="#27221D" />
            <path d="M10 31a22 22 0 0 1 44 0z" fill="#E3A83B" stroke="#27221D" strokeWidth="3" strokeLinejoin="round" />
            <path d="M32 29V18.5M32 29h6.5" stroke="#27221D" strokeWidth="3" strokeLinecap="round" />
            <circle cx="32" cy="29" r="2.4" fill="#27221D" />
            <rect x="9" y="33" width="46" height="25" rx="6" fill="#8B2923" stroke="#27221D" strokeWidth="3" />
            <path d="M9.5 45.5h45" stroke="#F5EBD6" strokeWidth="2.4" />
            <rect x="27" y="41.5" width="10" height="8" rx="2" fill="#F5EBD6" stroke="#27221D" strokeWidth="2.2" />
          </svg>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 800, color: "#27221D", letterSpacing: -3 }}>
            Dabba<span style={{ color: "#8B2923", marginLeft: 20 }}>Bela</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 800, color: "#27221D", lineHeight: 1.02 }}>Home-style lunch,</div>
          <div style={{ fontSize: 72, fontWeight: 800, color: "#8B2923", lineHeight: 1.1 }}>wherever you work.</div>
          <div style={{ fontSize: 32, color: "#4A423A", marginTop: 26 }}>A new menu every week · offices, shops, colleges & homes in Kathmandu</div>
        </div>
      </div>
    ),
    size,
  );
}
