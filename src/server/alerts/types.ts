/**
 * Alerts (docs/SUPER_ADMIN_ARCHITECTURE.md §9). Detectors are read-only functions that return findings; the
 * engine in ./index.ts turns them into persistent `Alert` rows keyed by `dedupeKey`.
 */
export const SEVERITIES = ["CRITICAL", "WARNING", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export type Finding = {
  /** Alert type, e.g. LOW_STOCK, UNPAID_ORDERS. */
  type: string;
  severity: Severity;
  /** 1 high … 3 low (default from severity). */
  priority?: 1 | 2 | 3;
  entity?: string | null;
  entityId?: string | null;
  /** Stable key within the detector; the stored dedupeKey is `${detector}:${key}`. */
  key: string;
  message: string;
  kitchenId?: string | null;
  /** Deep link for staff (admin path). */
  href?: string | null;
  data?: Record<string, unknown>;
};

export type DetectorCtx = {
  now: Date;
  /** Kathmandu date and time of `now`. */
  today: string;
  time: string;
  kitchens: { id: string; name: string; code: string }[];
};

/**
 * `condition` alerts describe a state (low stock, unpaid invoice): they auto-resolve when the detector stops
 * returning them and re-open when the state comes back. `event` alerts describe something that happened (a
 * failed-login burst, a permission change, a refund spike on a day): their key identifies the event, so they
 * never auto-resolve (the look-back window passing doesn't mean anyone dealt with it) and never re-open.
 */
export type Detector = {
  name: string;
  label: string;
  mode: "condition" | "event";
  run: (ctx: DetectorCtx) => Promise<Finding[]>;
};

export const SEVERITY_PRIORITY: Record<Severity, 1 | 2 | 3> = { CRITICAL: 1, WARNING: 2, INFO: 3 };

export function sev(s: string): Severity {
  const u = s.toUpperCase();
  return u === "CRITICAL" ? "CRITICAL" : u === "WARNING" || u === "WARN" ? "WARNING" : "INFO";
}

/** Short stable slug for keys built from text (digits removed so counts inside a message don't change the key). */
export function slug(text: string, words = 6) {
  return text
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .join("-");
}

/** Minutes since midnight for "HH:MM". */
export function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
