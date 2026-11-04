export type ActionResult = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  redirectTo?: string;
};

export const initialAction: ActionResult = { ok: false };

export function fail(message: string, errors?: Record<string, string>): ActionResult {
  return { ok: false, message, errors };
}

export function done(message = "Saved", redirectTo?: string): ActionResult {
  return { ok: true, message, redirectTo };
}
