"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const PLACEMENTS = ["TOP", "HOME", "MENU", "CHECKOUT"];
const TONES = ["turmeric", "achar", "saag", "charcoal"];
const ktm = (d: string, end = false) => new Date(`${d}T${end ? "23:59:59" : "00:00:00"}+05:45`);

export async function saveBanner(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("marketing", async (user) => {
    const text = f.str(fd, "text", 200);
    if (!text) throw new FieldError("text", "Write the banner text");
    const link = f.opt(fd, "link", 300);
    if (link && !/^(\/|https?:\/\/)/.test(link)) throw new FieldError("link", "Link must start with / or https://");
    const startsAt = f.date(fd, "startsAt");
    const endsAt = f.date(fd, "endsAt");
    if (startsAt && endsAt && endsAt < startsAt) throw new FieldError("endsAt", "Ends before it starts");
    const data = {
      placement: PLACEMENTS.includes(f.str(fd, "placement")) ? f.str(fd, "placement") : "TOP",
      text,
      textNe: f.opt(fd, "textNe", 200),
      link,
      linkLabel: f.opt(fd, "linkLabel", 40),
      tone: TONES.includes(f.str(fd, "tone")) ? f.str(fd, "tone") : "turmeric",
      startsAt: startsAt ? ktm(startsAt) : null,
      endsAt: endsAt ? ktm(endsAt, true) : null,
      isActive: f.bool(fd, "isActive"),
      sortOrder: f.int(fd, "sortOrder", 0),
    };
    const before = id ? await db.banner.findUnique({ where: { id } }) : null;
    const b = id ? await db.banner.update({ where: { id }, data }) : await db.banner.create({ data });
    await audit({ actorId: user.id, action: id ? "banner.update" : "banner.create", entity: "Banner", entityId: b.id, summary: text.slice(0, 60), before, after: data });
    return done("Banner saved", "/admin/banners");
  }, ["/admin/banners", "/"]);
}

export async function deleteBanner(id: string): Promise<ActionResult> {
  return guarded("marketing", async (user) => {
    const b = await db.banner.findUnique({ where: { id } });
    if (!b) return fail("Not found");
    await db.banner.delete({ where: { id } });
    await audit({ actorId: user.id, action: "banner.delete", entity: "Banner", entityId: id, before: b });
    return done("Deleted", "/admin/banners");
  }, ["/admin/banners", "/"]);
}
