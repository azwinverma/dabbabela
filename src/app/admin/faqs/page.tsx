import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { toggleFaq, deleteFaq } from "./actions";

export default async function FaqsPage() {
  await requirePermission("content.view");
  const faqs = await db.faq.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] });
  const cats = [...new Set(faqs.map((f) => f.category))];
  return (
    <>
      <PageHeader title="FAQs" description="Grouped by category on the public FAQ page." actions={<Link href="/admin/faqs/new" className={buttonClass("primary", "sm")}>Add question</Link>} />
      {faqs.length === 0 && <p className="py-12 text-center text-sm text-ink-mute">No questions yet.</p>}
      <div className="space-y-6">
        {cats.map((c) => (
          <Panel key={c} title={c} bodyClass="p-0">
            <ul className="divide-y divide-ink-line/50">
              {faqs
                .filter((f) => f.category === c)
                .map((f) => (
                  <li key={f.id} className={`flex items-start gap-4 px-4 py-3 ${f.published ? "" : "opacity-60"}`}>
                    <span className="w-6 pt-0.5 text-xs tabular-nums text-ink-mute">{f.sortOrder}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/faqs/${f.id}`} className="font-semibold hover:text-sindoor">
                        {f.question}
                      </Link>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-mute">{f.answer}</p>
                    </div>
                    {!f.published && <Badge>Hidden</Badge>}
                    <div className="flex shrink-0">
                      <ConfirmAction action={toggleFaq.bind(null, f.id)} label={f.published ? "Hide" : "Show"} variant="ghost" />
                      <ConfirmAction action={deleteFaq.bind(null, f.id)} label="Delete" variant="ghost" confirm="Delete this question?" />
                    </div>
                  </li>
                ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
