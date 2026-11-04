"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/site/cart";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { deleteCustomBoxAction, renameCustomBoxAction } from "@/lib/actions/shop";
import { formatDay } from "@/lib/dates";

export function BoxActions({ id, name, price, dates }: { id: string; name: string; price: number; dates: string[] }) {
  const cart = useCart();
  const router = useRouter();
  const [date, setDate] = useState(dates[0] ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="label">Order for</span>
          <select value={date} onChange={(e) => setDate(e.target.value)} className="field">
            {dates.map((d) => (
              <option key={d} value={d}>
                {formatDay(d)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!date}
          onClick={() => {
            cart.add({ kind: "custom", id, name, price, date });
            setMsg(`Added for ${formatDay(date)}`);
          }}
          className="h-11 rounded-xl border-2 border-ink bg-sindoor px-4 text-sm font-bold text-paper-card shadow-sticker-sm disabled:opacity-50"
        >
          Add to my dabbas
        </button>
      </div>
      {msg && (
        <p role="status" className="text-sm font-semibold text-saag-dark">
          {msg} · <a href="/checkout" className="underline">Checkout</a>
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => setRenaming((r) => !r)} className="font-semibold underline underline-offset-2">
          Rename
        </button>
        <a href={`/build?edit=${id}`} className="font-semibold underline underline-offset-2">
          Edit in builder
        </a>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete this saved dabba?")) return;
            start(async () => {
              const r = await deleteCustomBoxAction(id);
              if (!r.ok) setMsg(r.message ?? "Couldn't delete");
              router.refresh();
            });
          }}
          className="font-semibold text-sindoor underline underline-offset-2"
        >
          Delete
        </button>
      </div>
      {renaming && (
        <ActionForm action={renameCustomBoxAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          <input name="name" defaultValue={name} maxLength={60} className="field max-w-xs" aria-label="New name" />
          <SubmitButton size="sm">Save</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
