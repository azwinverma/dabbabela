"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { subscribeAction } from "@/lib/actions/public";

export function NewsletterForm({ labels }: { labels: { email: string; subscribe: string; hint: string } }) {
  return (
    <ActionForm action={subscribeAction} resetOnSuccess className="mt-3">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="nl-email">{labels.email}</label>
        <input id="nl-email" name="email" type="email" required autoComplete="email" placeholder={labels.email} className="h-10 min-w-0 flex-1 rounded-lg border border-paper/30 bg-white/10 px-3 text-sm text-paper placeholder:text-paper/50 focus:border-besar focus:outline-none" />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <input type="hidden" name="source" value="footer" />
        <SubmitButton variant="besar" size="sm" pendingText="…">{labels.subscribe}</SubmitButton>
      </div>
      <label className="mt-2 flex items-start gap-2 text-xs text-paper/70">
        <input type="checkbox" name="consent" required className="mt-0.5 accent-besar" />
        <span>{labels.hint}</span>
      </label>
    </ActionForm>
  );
}
