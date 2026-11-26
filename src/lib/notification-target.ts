/**
 * Structured deep-link target for a notification, derived from its web `link` (website path). The mobile app opens
 * the matching screen; `url` means "no native screen — open the link (or ignore it)". Used by the v1 notification
 * list and the push `data` payload, so both always agree.
 */
export type NotificationTargetType = "order" | "plan" | "payment" | "wallet" | "ticket" | "url";
export type NotificationTarget = { type: NotificationTargetType; id?: string };

const ID = "([A-Za-z0-9_-]{1,64})";
const RULES: [RegExp, NotificationTargetType, boolean][] = [
  [new RegExp(`^/account/orders/${ID}(?:[/?#]|$)`), "order", true],
  [new RegExp(`^/account/plans/${ID}(?:[/?#]|$)`), "plan", true],
  [new RegExp(`^/account/wallet/topup/${ID}(?:[/?#]|$)`), "payment", true],
  [new RegExp(`^/(?:pay|thank-you)/${ID}(?:[/?#]|$)`), "payment", true],
  [/^\/account\/wallet(?:[/?#]|$)/, "wallet", false],
  [new RegExp(`^/account/support/${ID}(?:[/?#]|$)`), "ticket", true],
];

export function notificationTarget(link: string | null | undefined): NotificationTarget | null {
  if (!link) return null;
  let path = link.trim();
  // Absolute links to our own site are treated like paths; anything else is just a URL.
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname + new URL(path).search + new URL(path).hash;
  } catch {
    return { type: "url" };
  }
  for (const [re, type, hasId] of RULES) {
    const m = re.exec(path);
    if (m) return hasId ? { type, id: m[1] } : { type };
  }
  return { type: "url" };
}
