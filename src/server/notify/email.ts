import "server-only";
import { log } from "@/lib/logger";

export type EmailResult = { ok: boolean; skipped?: boolean; error?: string };

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Resend adapter. Returns skipped when no provider is configured (dev). */
export async function deliverEmail(to: string, subject: string, html: string): Promise<EmailResult> {
  if (!emailConfigured()) {
    log.info("email.skipped_no_provider", { to, subject });
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Plain branded wrapper. `body` is trusted template HTML; variables are escaped before substitution. */
export function emailShell(brand: string, title: string, body: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#F5EBD6;padding:24px">
  <div style="max-width:560px;margin:auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e4d6b8">
    <div style="font-weight:800;font-size:20px;color:#8B2923">${esc(brand)}</div>
    <h2 style="color:#27221D;margin:16px 0 8px;font-size:20px">${esc(title)}</h2>
    <div style="color:#27221D;font-size:15px;line-height:1.6">${body}</div>
  </div></div>`;
}

export { esc as escapeHtml };
