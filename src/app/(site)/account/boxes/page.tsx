import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { rs } from "@/lib/money";
import { orderableDates } from "@/server/calendar";
import { priceCustomBox, type CustomPick } from "@/server/builder";
import { LinkButton } from "@/components/ui/Button";
import { DIET_LABEL } from "@/lib/labels";
import { BoxActions } from "./BoxActions";

export default async function SavedBoxes() {
  const user = await requireUser("/account/boxes");
  const settings = await getSettings();
  const kitchenId = user.addresses.find((a) => a.isDefault)?.zone?.kitchenId ?? null;
  const [boxes, dates] = await Promise.all([db.customBox.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }), orderableDates(settings, 12, kitchenId)]);
  const priced = await Promise.all(boxes.map((b) => priceCustomBox(b.items as unknown as CustomPick[], settings)));
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-extrabold">Saved dabbas</h2>
        <LinkButton href="/build" size="sm" variant="outline">Build a new one</LinkButton>
      </div>
      {boxes.length === 0 ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-ink-line p-8 text-center">
          <p className="text-ink-soft">Build your own dabba once, save it, and reorder it any day.</p>
          <LinkButton href="/build" className="mt-4">Build a dabba</LinkButton>
        </div>
      ) : (
        <ul className="mt-5 grid gap-4 md:grid-cols-2">
          {boxes.map((b, i) => {
            const p = priced[i];
            return (
              <li key={b.id} className="rounded-2xl border-2 border-ink bg-paper-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-lg font-extrabold">{b.name}</p>
                  <p className="text-lg font-extrabold tabular-nums">{rs(p.price)}</p>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{p.details}</p>
                <p className="mt-1 text-xs text-ink-mute">
                  {DIET_LABEL[p.diet].label}
                  {p.allergens.length ? ` · contains ${p.allergens.join(", ").toLowerCase()}` : ""}
                </p>
                {p.problem && <p className="mt-2 rounded bg-sindoor-light px-2 py-1 text-xs text-sindoor-dark">Needs attention: {p.problem}</p>}
                {p.price !== b.price && !p.problem && <p className="mt-2 text-xs text-ink-mute">Price updated from {rs(b.price)} to today's dish prices.</p>}
                {!p.problem && <BoxActions id={b.id} name={b.name} price={p.price} dates={dates} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
