/**
 * The client IP from headers the platform sets (security review L2) — pure, so rate limiting, audit rows and
 * LoginEvent all use the same rule. Never the left-most X-Forwarded-For value (a client can put anything there):
 *   1. on Vercel (`VERCEL` env set): `x-vercel-forwarded-for`, then `x-real-ip` — both set by Vercel's edge, which
 *      overwrites client-supplied values;
 *   2. otherwise the RIGHT-most X-Forwarded-For hop, i.e. the address our own nearest proxy saw (TRUSTED_PROXY_HOPS
 *      = how many proxies we run in front of the app that each append one hop; default 1). Off Vercel the app must
 *      sit behind such a proxy (docs/SECURITY.md);
 *   3. null when nothing usable is there (dev, tests, scripts).
 */
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

export function trustedClientIp(h: { get(name: string): string | null } | null | undefined): string | null {
  if (!h) return null;
  if (process.env.VERCEL) {
    const platform = (h.get("x-vercel-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
    if (IP_RE.test(platform)) return platform;
  }
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const trusted = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  const ip = hops.length ? hops[Math.max(0, hops.length - trusted)] : "";
  return IP_RE.test(ip) ? ip : null;
}
