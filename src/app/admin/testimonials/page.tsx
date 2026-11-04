import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Callout, EmptyState } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { promoteFeedback, toggleTestimonial } from "./actions";

export default async function TestimonialsPage() {
  await requirePermission("content.view");
  const [items, feedback] = await Promise.all([
    db.testimonial.findMany({ orderBy: [{ published: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }] }),
    db.feedback.findMany({ where: { publishConsent: true, comment: { not: null } }, orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } }),
  ]);
  const promoted = new Set(items.map((t) => t.feedbackId).filter(Boolean));
  return (
    <>
      <PageHeader title="Testimonials" description="Only real customers, only with their consent. Nothing is published without a consent note." actions={<Link href="/admin/testimonials/new" className={buttonClass("primary", "sm")}>Add testimonial</Link>} />
      <Callout tone="warn" className="mb-6">Never invent reviews, ratings or customer counts. Quote first names only unless the person agreed to more.</Callout>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="grid gap-3 md:grid-cols-2">
          {items.length === 0 && <EmptyState title="No testimonials yet">Promote consented feedback from the right, or add one you have written permission for.</EmptyState>}
          {items.map((t) => (
            <div key={t.id} className={`rounded-xl border border-ink-line/80 bg-white p-4 shadow-card ${t.published ? "" : "opacity-70"}`}>
              <p className="text-sm">“{t.quote}”</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div>
                  <Link href={`/admin/testimonials/${t.id}`} className="font-semibold hover:text-sindoor">
                    {t.name}
                  </Link>
                  <p className="text-xs text-ink-mute">{[t.role, t.company].filter(Boolean).join(", ")}</p>
                </div>
                <div className="flex items-center gap-2">
                  {t.rating && <span className="text-sm text-besar-dark" aria-label={`${t.rating} of 5`}>{"★".repeat(t.rating)}</span>}
                  {t.published ? <Badge tone="good">Live</Badge> : <Badge>Hidden</Badge>}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-ink-mute">Consent: {t.consentNote || <b className="text-sindoor">missing</b>}</p>
              <div className="mt-2 text-right">
                <ConfirmAction action={toggleTestimonial.bind(null, t.id)} label={t.published ? "Hide" : "Publish"} variant="ghost" />
              </div>
            </div>
          ))}
        </div>
        <Panel title="Feedback customers agreed to share">
          {feedback.length === 0 ? (
            <p className="text-sm text-ink-mute">None yet. Customers can tick “you may quote me” when rating a delivered order.</p>
          ) : (
            <ul className="space-y-3">
              {feedback.map((fb) => (
                <li key={fb.id} className="rounded-lg border border-ink-line/60 p-3 text-sm">
                  <p>“{fb.comment}”</p>
                  <p className="mt-1 text-xs text-ink-mute">
                    {fb.user.name.split(" ")[0]} · {"★".repeat(fb.rating)} · {formatStamp(fb.createdAt)}
                  </p>
                  <div className="mt-2 text-right">{promoted.has(fb.id) ? <Badge>promoted</Badge> : <ConfirmAction action={promoteFeedback.bind(null, fb.id)} label="Use as testimonial" variant="outline" />}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
