import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ORDER_STATUS, ORDER_PAYMENT_STATUS } from "@/lib/labels";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import type { OrderStatus, OrderPaymentStatus } from "@prisma/client";

export type OrderRowData = {
  id: string;
  number: string;
  deliveryDate: Date;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  customerShare: number;
  total: number;
  slotLabel: string | null;
  source: string;
  items: { name: string; quantity: number }[];
};

export function OrderRow({ o, actions }: { o: OrderRowData; actions?: React.ReactNode }) {
  const st = ORDER_STATUS[o.status];
  const pay = ORDER_PAYMENT_STATUS[o.paymentStatus];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-2 border-ink-line bg-white px-4 py-3">
      <div className="w-24 shrink-0">
        <p className="text-sm font-extrabold">{formatDay(isoDate(o.deliveryDate))}</p>
        <p className="text-xs text-ink-mute">{o.slotLabel ?? "Lunch"}</p>
      </div>
      <div className="min-w-0 flex-1">
        <Link href={`/account/orders/${o.id}`} className="font-semibold hover:underline">
          {o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ")}
        </Link>
        <p className="text-xs text-ink-mute">
          #{o.number}
          {o.source === "SUBSCRIPTION" ? " · plan meal" : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        {o.status !== "CANCELLED" && o.status !== "SKIPPED" && <Badge tone={pay.tone}>{pay.label}</Badge>}
        <span className="w-20 text-right text-sm font-bold tabular-nums">{rs(o.customerShare)}</span>
      </div>
      {actions && <div className="w-full sm:w-auto">{actions}</div>}
    </li>
  );
}
