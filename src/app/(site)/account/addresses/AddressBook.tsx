"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddressCard, AddressForm, type AddressView } from "@/components/site/DeliveryFields";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { deleteAddressAction, setDefaultAddressAction } from "@/lib/actions/account";

export function AddressBook({ addresses, defaults }: { addresses: AddressView[]; defaults: { recipientName: string; phone: string } }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(addresses.length ? null : "new");
  return (
    <div className="space-y-4">
      {addresses.map((a) =>
        editing === a.id ? (
          <div key={a.id} className="rounded-2xl border-2 border-ink bg-paper-card p-5">
            <AddressForm address={a} onSaved={() => { setEditing(null); router.refresh(); }} onCancel={() => setEditing(null)} />
          </div>
        ) : (
          <div key={a.id}>
            <AddressCard a={a} />
            <div className="mt-2 flex flex-wrap items-center gap-3 px-1 text-sm">
              {a.isDefault ? (
                <span className="font-bold text-saag-dark">Default</span>
              ) : (
                <ActionForm action={setDefaultAddressAction} showMessage={false}>
                  <input type="hidden" name="id" value={a.id} />
                  <SubmitButton size="sm" variant="ghost">Make default</SubmitButton>
                </ActionForm>
              )}
              <button type="button" onClick={() => setEditing(a.id)} className="font-semibold underline underline-offset-2">Edit</button>
              <ActionForm action={deleteAddressAction}>
                <input type="hidden" name="id" value={a.id} />
                <SubmitButton size="sm" variant="ghost" confirm="Remove this address?">Remove</SubmitButton>
              </ActionForm>
              {!a.zoneName && <span className="text-xs text-sindoor">We'll tell you when we start delivering to {a.area}.</span>}
            </div>
          </div>
        ),
      )}
      {editing === "new" ? (
        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <h3 className="mb-4 text-lg font-extrabold">New address</h3>
          <AddressForm defaults={defaults} onSaved={() => { setEditing(null); router.refresh(); }} onCancel={addresses.length ? () => setEditing(null) : undefined} />
        </div>
      ) : (
        <button type="button" onClick={() => setEditing("new")} className="w-full rounded-2xl border-2 border-dashed border-ink p-4 text-sm font-bold hover:bg-besar-light">
          + Add an address
        </button>
      )}
    </div>
  );
}
