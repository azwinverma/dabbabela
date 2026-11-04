import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CompanyForms, PreferencesForm, ProfileForm } from "./ProfileForms";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account/profile");
  const allergens = await db.allergen.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true, nameNe: true } });
  const phoneOnly = user.email.endsWith("@phone.dabbabela.local");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {sp.welcome && phoneOnly && (
        <p className="rounded-xl border-2 border-ink bg-besar-light p-4 text-sm lg:col-span-2">Welcome! Add your name and an email so we can send receipts.</p>
      )}
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h2 className="text-xl font-extrabold">Profile</h2>
        <div className="mt-4">
          <ProfileForm p={{ name: user.name === "New member" ? "" : user.name, email: user.email, phone: user.phoneNumber ?? "", locale: user.locale, marketingOptIn: user.marketingOptIn, phoneOnly }} />
        </div>
      </section>
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h2 className="text-xl font-extrabold">Food preferences</h2>
        <div className="mt-4">
          <PreferencesForm prefs={{ diet: user.diet, spiceTolerance: user.spiceTolerance, allergies: user.allergies, avoidOnionGarlic: user.avoidOnionGarlic, dietaryNotes: user.dietaryNotes ?? "" }} allergens={allergens} />
        </div>
      </section>
      <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h2 className="text-xl font-extrabold">Company account</h2>
        <p className="mt-1 text-sm text-ink-soft">Linking to your employer gives you their lunch pricing; some companies pay part or all of each meal.</p>
        <div className="mt-4">
          <CompanyForms membership={user.membership ? { company: user.membership.company.name, status: user.membership.status, role: user.membership.role } : null} />
        </div>
      </section>
    </div>
  );
}
