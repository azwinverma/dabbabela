"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Fields";
import { joinCompanyAction, leaveCompanyAction, updatePreferencesAction, updateProfileAction } from "@/lib/actions/account";

type Profile = { name: string; email: string; phone: string; locale: string; marketingOptIn: boolean; phoneOnly: boolean };
type Prefs = { diet: string; spiceTolerance: number; allergies: string[]; avoidOnionGarlic: boolean; dietaryNotes: string };

export function ProfileForm({ p }: { p: Profile }) {
  return (
    <ActionForm action={updateProfileAction} className="space-y-4">
      {(state) => (
        <>
          <Input label="Full name" name="name" defaultValue={p.name} required error={state.errors?.name} />
          {p.phoneOnly ? (
            <Input label="Email" name="email" type="email" placeholder="Add your email for receipts" error={state.errors?.email} />
          ) : (
            <Input label="Email" name="emailShown" value={p.email} disabled hint="Contact us to change your email" />
          )}
          <Input label="Mobile" name="phone" type="tel" defaultValue={p.phone.replace(/^\+977/, "")} placeholder="98XXXXXXXX" error={state.errors?.phone} />
          <Select
            label="Language"
            name="locale"
            defaultValue={p.locale}
            options={[
              { value: "en", label: "English" },
              { value: "ne", label: "नेपाली" },
            ]}
          />
          <Checkbox name="marketingOptIn" defaultChecked={p.marketingOptIn} label="Tell me about new menus and offers" hint="At most once a week. Unsubscribe any time." />
          <SubmitButton>Save profile</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function PreferencesForm({ prefs, allergens }: { prefs: Prefs; allergens: { code: string; name: string; nameNe: string | null }[] }) {
  return (
    <ActionForm action={updatePreferencesAction} className="space-y-4">
      <Select
        label="What do you eat?"
        name="diet"
        defaultValue={prefs.diet}
        options={[
          { value: "ANY", label: "Everything" },
          { value: "EGG_OK", label: "Vegetarian + egg" },
          { value: "VEG", label: "Vegetarian (no egg)" },
          { value: "VEGAN", label: "Vegan" },
        ]}
      />
      <Select
        label="Spice"
        name="spiceTolerance"
        defaultValue={String(prefs.spiceTolerance)}
        options={[
          { value: "0", label: "No chilli" },
          { value: "1", label: "Mild" },
          { value: "2", label: "Medium" },
          { value: "3", label: "Hot" },
          { value: "4", label: "Very hot" },
        ]}
      />
      <fieldset>
        <legend className="label">Allergies</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {allergens.map((a) => (
            <Checkbox key={a.code} name="allergies" value={a.code} defaultChecked={prefs.allergies.includes(a.code)} label={a.name} hint={a.nameNe ?? undefined} />
          ))}
        </div>
      </fieldset>
      <div role="note" className="rounded-xl border-2 border-sindoor bg-sindoor-light px-4 py-3 text-sm text-sindoor-dark">
        <strong>Please read:</strong> we flag dishes that contain your allergens and print them on your label, but every dish is cooked in a shared kitchen that handles wheat, milk, egg, soy, sesame and mustard. <strong>We cannot guarantee zero cross-contact.</strong> If your allergy is severe, talk to us before ordering.
      </div>
      <Checkbox name="avoidOnionGarlic" defaultChecked={prefs.avoidOnionGarlic} label="I avoid onion and garlic" hint="We'll show which dishes contain them — most of our recipes do." />
      <Textarea label="Anything else the kitchen should know?" name="dietaryNotes" rows={2} defaultValue={prefs.dietaryNotes} maxLength={300} />
      <SubmitButton>Save food preferences</SubmitButton>
    </ActionForm>
  );
}

export function CompanyForms({ membership }: { membership: { company: string; status: string; role: string } | null }) {
  if (membership && membership.status !== "REMOVED")
    return (
      <div className="space-y-3 text-sm">
        <p>
          {membership.status === "ACTIVE" ? "You're on the " : "Waiting for approval from "}
          <strong>{membership.company}</strong>
          {membership.role === "ADMIN" ? " (admin)" : ""}.
        </p>
        <ActionForm action={leaveCompanyAction}>
          <SubmitButton size="sm" variant="danger" confirm="Leave the company account? Team pricing stops for new orders.">
            Leave company account
          </SubmitButton>
        </ActionForm>
      </div>
    );
  return (
    <ActionForm action={joinCompanyAction} className="space-y-3">
      <Input label="Company code" name="code" placeholder="e.g. ABC26" hint="Your office admin can give you this." maxLength={20} />
      <SubmitButton size="sm">Join</SubmitButton>
    </ActionForm>
  );
}
