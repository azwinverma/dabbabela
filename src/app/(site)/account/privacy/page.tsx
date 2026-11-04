import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { DeleteForm } from "./DeleteForm";

export default async function PrivacyPage() {
  const user = await requireUser("/account/privacy");
  const requests = await db.dataRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h2 className="text-xl font-extrabold">Download your data</h2>
        <p className="mt-2 text-sm text-ink-soft">A JSON file with your profile, addresses, food preferences, orders, plans, credit history, feedback and support messages.</p>
        <a href="/account/privacy/export" className="mt-4 inline-flex h-9 items-center rounded-xl border-2 border-ink px-3 text-sm font-semibold hover:bg-ink hover:text-paper" download>
          Download my data
        </a>
        <p className="mt-3 text-xs text-ink-mute">
          How we use your data: <Link href="/info/privacy" className="underline">privacy policy</Link>.
        </p>
      </section>
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h2 className="text-xl font-extrabold">Delete your account</h2>
        <p className="mt-2 text-sm text-ink-soft">
          We remove your profile, addresses and preferences and sign you out everywhere. Orders, invoices and payments must be kept for tax law, so those are anonymised instead of deleted. Active plans should be cancelled first.
        </p>
        <div className="mt-4">
          <DeleteForm />
        </div>
        {requests.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-ink-mute">
            {requests.map((r) => (
              <li key={r.id}>
                {r.type.toLowerCase()} request · {r.status.toLowerCase()} · {formatStamp(r.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
