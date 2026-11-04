import type { PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getSettings, PAYMENT_LABEL, type FeatureFlags } from "@/lib/settings";
import { WEEKDAYS, WEEKDAY_LABEL } from "@/lib/dates";
import { rupeesInput } from "@/lib/money";
import { esewaConfigured, khaltiConfigured } from "@/server/payments/methods";
import { emailConfigured } from "@/server/notify/email";
import { smsConfigured } from "@/server/notify/sms";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Checkbox, Select } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ImageField } from "@/components/admin/ImageField";
import { updateSettings } from "./actions";

const FLAG_LABEL: Record<keyof FeatureFlags, [string, string]> = {
  phoneOtp: ["Sign in with phone OTP", "Needs an SMS provider with an approved sender ID"],
  staff2fa: ["Require 2FA for staff", "Strongly recommended — staff can't open the control room without it"],
  wallet: ["Credit wallet", "Customers can pay with credit from cancellations and skips"],
  corporatePortal: ["Team portal", "Company admins manage their staff lunches"],
  deliveryOtp: ["Delivery hand-off code", "Riders confirm delivery with the customer's 4-digit code"],
  deliveryPhoto: ["Delivery photo", "Riders can attach a photo as proof"],
  newsletter: ["Newsletter sign-up", "Shows the email sign-up form (with consent text)"],
  feedback: ["Feedback after delivery", "Ask customers to rate delivered lunches"],
  nepaliDates: ["Bikram Sambat dates", "Leave off until a tested BS calendar library is added"],
};

function Status({ ok, label, note }: { ok: boolean; label: string; note?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <span>
        <span className="font-medium">{label}</span>
        {note && <span className="block text-xs text-ink-mute">{note}</span>}
      </span>
      {ok ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Not set</Badge>}
    </li>
  );
}

export default async function SettingsPage() {
  await requirePermission("settings");
  const s = await getSettings();
  const dbOk = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const sandbox = !process.env.ESEWA_SECRET_KEY;
  const configured: Record<PaymentMethod, { ok: boolean; note: string }> = {
    ESEWA: { ok: esewaConfigured(), note: sandbox ? "Sandbox keys (test only) — add merchant keys to go live" : "Merchant keys set" },
    KHALTI: { ok: khaltiConfigured(), note: khaltiConfigured() ? "Secret key set" : "Add KHALTI_SECRET_KEY" },
    BANK_TRANSFER: { ok: Boolean(s.bankDetails || s.qrImage), note: "Needs bank details or a QR image below; finance verifies each transfer" },
    CASH: { ok: true, note: "Collected by riders, reconciled per route" },
    COMPANY_INVOICE: { ok: true, note: "Automatic for company shares — not a checkout choice" },
    WALLET: { ok: s.flags.wallet, note: "Controlled by the wallet flag" },
  };

  return (
    <>
      <PageHeader title="Settings & flags" description="Business details, ordering rules, payments and feature switches. Every change is recorded in the audit log." />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <ActionForm action={updateSettings} className="space-y-6">
          <>
            <>
              <Panel title="Brand & business">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input name="brandName" label="Brand name" defaultValue={s.brandName} />
                  <Input name="brandNameNe" label="Brand name (Nepali)" defaultValue={s.brandNameNe} className="lang-ne" />
                  <Input name="tagline" label="Tagline" defaultValue={s.tagline} />
                  <Input name="taglineNe" label="Tagline (Nepali)" defaultValue={s.taglineNe} className="lang-ne" />
                  <Input name="legalName" label="Registered company name" defaultValue={s.legalName} />
                  <Input name="panVat" label="PAN / VAT number" defaultValue={s.panVat} />
                  <Input name="phone" label="Phone" defaultValue={s.phone} />
                  <Input name="whatsapp" label="WhatsApp (digits, with 977)" defaultValue={s.whatsapp} />
                  <Input name="email" type="email" label="Public email" defaultValue={s.email} />
                  <Input name="notifyEmail" type="email" label="Staff alert email" defaultValue={s.notifyEmail} hint="New leads, failed jobs" />
                  <Input name="address" label="Address" defaultValue={s.address} />
                  <Input name="hours" label="Hours" defaultValue={s.hours} />
                </div>
              </Panel>

              <Panel title="Ordering rules">
                <div className="grid gap-4 md:grid-cols-3">
                  <Input name="orderCutoff" label="Same-day cut-off" defaultValue={s.orderCutoff} placeholder="09:30" hint="Kathmandu time. Also when the day locks." />
                  <Input name="advanceDays" type="number" min={1} label="Book up to (days ahead)" defaultValue={s.advanceDays} />
                  <Input name="minOrderAmount" label="Minimum order per day (Rs)" defaultValue={rupeesInput(s.minOrderAmount)} />
                  <Input name="freeDeliveryAbove" label="Free delivery above (Rs/day)" defaultValue={rupeesInput(s.freeDeliveryAbove)} hint="0 = never by amount; zones can override" />
                  <Select name="skipPolicy" label="When a plan meal is skipped" defaultValue={s.skipPolicy} options={[{ value: "EXTEND", label: "Move it to the end of the plan" }, { value: "CREDIT", label: "Credit its value to the wallet" }]} />
                  <Select name="cancelBeforeCutoff" label="Cancelling before cut-off" defaultValue={s.cancelBeforeCutoff} options={[{ value: "FULL_CREDIT", label: "Full credit to wallet" }, { value: "FULL_REFUND", label: "Full refund (finance processes)" }]} />
                </div>
                <fieldset className="mt-4">
                  <legend className="label">Delivery days</legend>
                  <div className="flex flex-wrap gap-4">
                    {WEEKDAYS.map((d) => (
                      <Checkbox key={d} name={`day_${d}`} label={WEEKDAY_LABEL[d]} defaultChecked={s.deliveryDays.includes(d)} />
                    ))}
                  </div>
                </fieldset>
              </Panel>

              <Panel title="Payments">
                <ul className="divide-y divide-ink-line/50">
                  {(Object.keys(configured) as PaymentMethod[]).map((m) => (
                    <li key={m} className="flex items-center justify-between gap-3 py-2">
                      <Checkbox name={`pm_${m}`} label={PAYMENT_LABEL[m]} hint={configured[m].note} defaultChecked={s.paymentMethods[m]} />
                      <Badge tone={configured[m].ok ? "good" : "warn"}>{configured[m].ok ? "configured" : "not configured — hidden"}</Badge>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Textarea name="bankDetails" label="Bank transfer details" rows={4} defaultValue={s.bankDetails} />
                  <ImageField name="qrImage" label="Fonepay / bank QR" defaultValue={s.qrImage} />
                </div>
              </Panel>

              <Panel title="Feature flags">
                <div className="grid gap-3 md:grid-cols-2">
                  {(Object.keys(FLAG_LABEL) as (keyof FeatureFlags)[]).map((k) => (
                    <Checkbox key={k} name={`flag_${k}`} label={FLAG_LABEL[k][0]} hint={FLAG_LABEL[k][1]} defaultChecked={s.flags[k]} />
                  ))}
                </div>
              </Panel>

              <Panel title="Search & social">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input name="seoTitle" label="Default page title" defaultValue={s.seoTitle} className="md:col-span-2" />
                  <Textarea name="seoDescription" label="Default description" rows={3} defaultValue={s.seoDescription} className="md:col-span-2" />
                  <Input name="facebook" label="Facebook URL" defaultValue={s.facebook} />
                  <Input name="instagram" label="Instagram URL" defaultValue={s.instagram} />
                  <Input name="tiktok" label="TikTok URL" defaultValue={s.tiktok} />
                  <ImageField name="ogImage" label="Social share image" defaultValue={s.ogImage} />
                </div>
              </Panel>

              <Panel title="Maintenance">
                <Checkbox name="maintenanceMode" label="Pause ordering" hint="The site stays up; checkout and plan purchases are refused with the message below" defaultChecked={s.maintenanceMode} />
                <Input name="maintenanceMessage" label="Message" defaultValue={s.maintenanceMessage} className="mt-3" />
              </Panel>
              <div className="sticky bottom-0 border-t border-ink-line/60 bg-[#F3EADB]/95 py-3 backdrop-blur">
                <SubmitButton>Save settings</SubmitButton>
              </div>
            </>
          </>
        </ActionForm>
        <Panel title="Integrations" className="h-fit">
          <ul className="divide-y divide-ink-line/50 text-sm">
            <Status ok={dbOk} label="Database" />
            <Status ok={Boolean(process.env.BLOB_READ_WRITE_TOKEN)} label="Image storage (Vercel Blob)" note="Uploads only work in development without it" />
            <Status ok={emailConfigured()} label="Email (Resend)" note="RESEND_API_KEY + EMAIL_FROM" />
            <Status ok={smsConfigured()} label="SMS" note="SMS_PROVIDER sparrow/aakash + token" />
            <Status ok={esewaConfigured() && !sandbox} label="eSewa live" note={sandbox ? "Using sandbox" : undefined} />
            <Status ok={khaltiConfigured()} label="Khalti" />
            <Status ok={Boolean(process.env.CRON_SECRET)} label="Scheduled jobs" note="CRON_SECRET for Vercel Cron" />
          </ul>
        </Panel>
      </div>
    </>
  );
}
