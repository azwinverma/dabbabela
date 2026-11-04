/**
 * Structured JSON logs with PII redaction. Vercel collects stdout; ship to a log drain for retention.
 */
const SECRET_KEYS = /pass(word)?|secret|token|otp|code|signature|authorization|cookie|key/i;
const EMAIL = /([A-Za-z0-9._%+-]{2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)/g;
const PHONE = /(\+?977)?(9[678])\d{5}(\d{3})/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") return value.replace(EMAIL, "$1•••@$2").replace(PHONE, "$1$2•••••$3");
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: redact(value.message) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, event: string, data?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  if (process.env.VITEST && level !== "error") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(redact(data ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (e: string, d?: Record<string, unknown>) => write("debug", e, d),
  info: (e: string, d?: Record<string, unknown>) => write("info", e, d),
  warn: (e: string, d?: Record<string, unknown>) => write("warn", e, d),
  error: (e: string, d?: Record<string, unknown>) => write("error", e, d),
};
