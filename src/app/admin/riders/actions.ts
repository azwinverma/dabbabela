"use server";

import { done, type ActionResult } from "@/lib/action";
import { deleteRiderProfile, saveRider, setRiderAvailable } from "@/server/dispatch";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";

/** Rider profiles. Permission (dispatch.edit) and kitchen scope are re-checked in dispatch.ts; every change is audited there. */
export async function saveRiderAction(userId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "dispatch.edit",
    async (user) => {
      await saveRider(user, {
        userId,
        vehicle: f.opt(fd, "vehicle", 60),
        phone: f.opt(fd, "phone", 20),
        isAvailable: f.bool(fd, "isAvailable"),
        zoneIds: f.all(fd, "zoneIds"),
        kitchenId: f.opt(fd, "kitchenId", 40),
        notes: f.opt(fd, "notes", 1000),
      });
      return done("Rider saved");
    },
    ["/admin/riders", `/admin/riders/${userId}`, "/admin/dispatch"],
  );
}

export async function riderAvailabilityAction(userId: string, isAvailable: boolean): Promise<ActionResult> {
  return guarded(
    "dispatch.edit",
    async (user) => {
      await setRiderAvailable(user, userId, isAvailable);
      return done(isAvailable ? "Rider available" : "Rider marked unavailable — dispatch won't offer them for new routes");
    },
    ["/admin/riders", "/admin/dispatch"],
  );
}

export async function deleteRiderAction(userId: string): Promise<ActionResult> {
  return guarded(
    "dispatch.edit",
    async (user) => {
      await deleteRiderProfile(user, userId);
      return done("Profile removed — the login stays under Staff", "/admin/riders");
    },
    ["/admin/riders"],
  );
}
