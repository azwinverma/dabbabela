"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { formatStamp } from "@/lib/dates";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

export async function saveTestimonial(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("content", async (user) => {
    const name = f.str(fd, "name", 80);
    const quote = f.str(fd, "quote", 600);
    const consentNote = f.str(fd, "consentNote", 300);
    if (!name || !quote) return fail("Name and quote are required");
    const published = f.bool(fd, "published");
    if (published && consentNote.length < 10) throw new FieldError("consentNote", "Record how and when the person agreed to be quoted before publishing");
    const rating = f.intOpt(fd, "rating");
    const data = {
      name,
      quote,
      role: f.opt(fd, "role", 80),
      company: f.opt(fd, "company", 80),
      rating: rating && rating >= 1 && rating <= 5 ? rating : null,
      avatar: f.opt(fd, "avatar", 500),
      consentNote,
      published,
      sortOrder: f.int(fd, "sortOrder", 0),
    };
    const before = id ? await db.testimonial.findUnique({ where: { id } }) : null;
    const t = id ? await db.testimonial.update({ where: { id }, data }) : await db.testimonial.create({ data });
    await audit({ actorId: user.id, action: id ? "testimonial.update" : "testimonial.create", entity: "Testimonial", entityId: t.id, summary: t.name, before, after: data });
    return done("Saved", "/admin/testimonials");
  }, ["/admin/testimonials", "/"]);
}

export async function toggleTestimonial(id: string): Promise<ActionResult> {
  return guarded("content", async (user) => {
    const t = await db.testimonial.findUnique({ where: { id } });
    if (!t) return fail("Not found");
    if (!t.published && (t.consentNote ?? "").length < 10) return fail("Add a consent note before publishing");
    await db.testimonial.update({ where: { id }, data: { published: !t.published } });
    await audit({ actorId: user.id, action: t.published ? "testimonial.hide" : "testimonial.publish", entity: "Testimonial", entityId: id, summary: t.name });
    return done();
  }, ["/admin/testimonials", "/"]);
}

export async function deleteTestimonial(id: string): Promise<ActionResult> {
  return guarded("content", async (user) => {
    const t = await db.testimonial.delete({ where: { id } });
    await audit({ actorId: user.id, action: "testimonial.delete", entity: "Testimonial", entityId: id, before: t });
    return done("Deleted", "/admin/testimonials");
  }, ["/admin/testimonials", "/"]);
}

/** Turn consented customer feedback into a (hidden) testimonial — first name only. */
export async function promoteFeedback(feedbackId: string): Promise<ActionResult> {
  return guarded("content", async (user) => {
    const fb = await db.feedback.findUnique({ where: { id: feedbackId }, include: { user: { select: { name: true } }, order: { select: { number: true } } } });
    if (!fb || !fb.publishConsent || !fb.comment?.trim()) return fail("Only feedback with a comment and the customer's consent can be quoted");
    if (await db.testimonial.findFirst({ where: { feedbackId } })) return fail("Already promoted");
    const t = await db.testimonial.create({
      data: {
        name: fb.user.name.split(/\s+/)[0] || "Customer",
        quote: fb.comment.trim().slice(0, 600),
        rating: fb.rating,
        feedbackId,
        consentNote: `Customer ticked "you may quote me" on feedback for order ${fb.order.number} (${formatStamp(fb.createdAt)}).`,
        published: false,
      },
    });
    await audit({ actorId: user.id, action: "testimonial.promote", entity: "Testimonial", entityId: t.id, summary: `from feedback ${feedbackId}` });
    return done("Added as a hidden testimonial — review and publish", `/admin/testimonials/${t.id}`);
  }, ["/admin/testimonials"]);
}
