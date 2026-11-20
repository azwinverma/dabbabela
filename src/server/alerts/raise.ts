import "server-only";
import { db } from "@/lib/db";
import { applyFindings } from "./index";
import { MISMATCH_SELECT, mismatchFinding, paymentMismatch } from "./detectors/integrations";

/**
 * Raise the GATEWAY_MISMATCH alert for one provider event right away (instead of waiting for the next detector
 * sweep). Same detector name + key as the sweep, so the alert is never duplicated. Event-mode: never auto-resolves.
 */
export async function raiseMismatchAlert(eventId: string) {
  const e = await db.paymentProviderEvent.findUnique({ where: { id: eventId }, select: MISMATCH_SELECT });
  if (!e) return null;
  return applyFindings(paymentMismatch, [mismatchFinding(e)]);
}
