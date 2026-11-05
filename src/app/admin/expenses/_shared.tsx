import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/lib/labels";
import { rupeesInput } from "@/lib/money";
import { todayKTM } from "@/lib/dates";
import { EXPENSE_METHODS } from "@/server/finance/expenses";

/** Shared bits for the WP-09 finance pages (expenses, payables, settlements, profitability). */

const TONE: Record<string, Tone> = { DRAFT: "warn", APPROVED: "info", PAID: "good", VOID: "neutral", OPEN: "warn", PARTIAL: "info" };
export function FinBadge({ status, children }: { status: string; children?: React.ReactNode }) {
  return <Badge tone={TONE[status] ?? "neutral"}>{children ?? status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export const label = "text-xs font-semibold text-ink-soft";
export const field = "field mt-1 w-full";

type Opt = { id: string; name: string };
export type ExpenseDefaults = {
  date?: string;
  categoryId?: string;
  kitchenId?: string | null;
  supplierId?: string | null;
  description?: string;
  amount?: number;
  tax?: number;
  method?: string | null;
  reference?: string | null;
};

/** Inputs for an expense (used by create, edit-draft and correct forms). */
export function ExpenseFields({ categories, kitchens, suppliers, d = {}, kitchenRequired }: { categories: Opt[]; kitchens: Opt[]; suppliers: Opt[]; d?: ExpenseDefaults; kitchenRequired?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className={label}>
        Date
        <input type="date" name="date" required max={todayKTM()} defaultValue={d.date ?? todayKTM()} className={field} />
      </label>
      <label className={label}>
        Category
        <select name="categoryId" required defaultValue={d.categoryId ?? ""} className={field}>
          <option value="">Pick…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Kitchen
        <select name="kitchenId" defaultValue={d.kitchenId ?? ""} className={field} required={kitchenRequired}>
          {!kitchenRequired && <option value="">Company-wide</option>}
          {kitchens.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Supplier (optional)
        <select name="supplierId" defaultValue={d.supplierId ?? ""} className={field}>
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${label} sm:col-span-2`}>
        Description
        <input name="description" required maxLength={300} defaultValue={d.description} className={field} placeholder="e.g. Gas cylinders × 4" />
      </label>
      <label className={label}>
        Amount before tax (Rs)
        <input name="amount" required inputMode="decimal" defaultValue={d.amount ? rupeesInput(d.amount) : ""} className={field} />
      </label>
      <label className={label}>
        VAT / tax (Rs)
        <input name="tax" inputMode="decimal" defaultValue={d.tax ? rupeesInput(d.tax) : ""} className={field} placeholder="0" />
      </label>
      <label className={label}>
        Paid / to pay by
        <select name="method" defaultValue={d.method ?? ""} className={field}>
          <option value="">Not decided</option>
          {EXPENSE_METHODS.map((m) => (
            <option key={m} value={m}>
              {m.charAt(0) + m.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Bill / reference no.
        <input name="reference" maxLength={120} defaultValue={d.reference ?? ""} className={field} />
      </label>
      <label className={`${label} sm:col-span-2`}>
        Receipt (image or PDF, max 5 MB)
        <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" className="mt-1 block w-full text-sm" />
      </label>
    </div>
  );
}
