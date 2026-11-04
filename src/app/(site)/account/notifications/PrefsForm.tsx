"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { saveNotificationPrefsAction } from "@/lib/actions/account";
import { PREF_CHANNELS, PREF_TOPICS } from "@/lib/actions/account-constants";

const TOPIC: Record<string, string> = { ORDER_UPDATES: "Order updates", PLAN_REMINDERS: "Plan reminders", MARKETING: "New menus & offers" };
const CHANNEL: Record<string, string> = { IN_APP: "In account", EMAIL: "Email", SMS: "SMS" };

export function PrefsForm({ prefs }: { prefs: Record<string, boolean> }) {
  return (
    <ActionForm action={saveNotificationPrefsAction}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="py-2 pr-4">Topic</th>
              {PREF_CHANNELS.map((c) => (
                <th key={c} className="px-3 py-2 text-center">{CHANNEL[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PREF_TOPICS.map((t) => (
              <tr key={t} className="border-t border-ink-line">
                <td className="py-2 pr-4 font-semibold">{TOPIC[t]}</td>
                {PREF_CHANNELS.map((c) => (
                  <td key={c} className="px-3 py-2 text-center">
                    <input type="checkbox" name={`${t}:${c}`} defaultChecked={prefs[`${t}:${c}`]} aria-label={`${TOPIC[t]} by ${CHANNEL[c]}`} className="h-4 w-4 accent-sindoor" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-mute">Security messages (password reset, sign-in codes) are always sent. SMS needs our SMS provider to be live.</p>
      <SubmitButton size="sm" className="mt-3">Save</SubmitButton>
    </ActionForm>
  );
}
