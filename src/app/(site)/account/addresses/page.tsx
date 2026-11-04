import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { toAddressViews } from "../_lib/view";
import { AddressBook } from "./AddressBook";

export default async function AddressesPage() {
  const user = await requireUser("/account/addresses");
  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-extrabold">Addresses</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Office, shop, college, work site or home — save each place you eat lunch. We check delivery by the area you type.{" "}
        <Link href="/delivery-areas" className="font-semibold text-sindoor underline">See where we deliver</Link>
      </p>
      <div className="mt-5">
        <AddressBook addresses={toAddressViews(user)} defaults={{ recipientName: user.name, phone: user.phoneNumber ?? "" }} />
      </div>
    </div>
  );
}
