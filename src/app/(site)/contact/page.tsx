import type { Metadata } from "next";
import { Mail, MessageCircle, Phone, MapPin } from "lucide-react";
import { getSection } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { formatNepalPhone, whatsappLink } from "@/lib/phone";
import { PageHero } from "@/components/site/Section";
import { ContactForm } from "./ContactForm";

export const metadata: Metadata = { title: "Contact", description: "Get in touch with Dabba Bela about orders, delivery areas or team lunches.", alternates: { canonical: "/contact" } };

export default async function ContactPage() {
  const { locale } = await getI18n();
  const [intro, s, user] = await Promise.all([getSection("contact.intro", locale), getSettings(), getCurrentUser()]);
  return (
    <>
      <PageHero eyebrow={String(intro.eyebrow)} title={String(intro.title)} intro={String(intro.intro)} />
      <div className="container grid gap-10 py-12 lg:grid-cols-[1.4fr_1fr]">
        <div className="card p-6 md:p-8">
          <ContactForm defaults={user ? { name: user.name, email: user.email.endsWith(".local") ? "" : user.email, phone: formatNepalPhone(user.phoneNumber) } : undefined} />
        </div>
        <aside className="space-y-4">
          {s.phone && (
            <a href={`tel:${s.phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-3 rounded-xl border-2 border-ink/15 bg-paper-card p-4 hover:border-ink">
              <Phone className="h-5 w-5 text-sindoor" aria-hidden /> <span className="font-semibold">{s.phone}</span>
            </a>
          )}
          {s.whatsapp && (
            <a href={whatsappLink(s.whatsapp, "Namaste! I have a question about Dabba Bela.")} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border-2 border-ink/15 bg-paper-card p-4 hover:border-ink">
              <MessageCircle className="h-5 w-5 text-saag" aria-hidden /> <span className="font-semibold">WhatsApp us</span>
            </a>
          )}
          {s.email && (
            <a href={`mailto:${s.email}`} className="flex items-center gap-3 rounded-xl border-2 border-ink/15 bg-paper-card p-4 hover:border-ink">
              <Mail className="h-5 w-5 text-sindoor" aria-hidden /> <span className="font-semibold">{s.email}</span>
            </a>
          )}
          {s.address && (
            <p className="flex items-start gap-3 rounded-xl bg-paper-deep/50 p-4 text-sm">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <span>
                {s.address}
                {s.hours && <span className="block text-ink-mute">{s.hours}</span>}
              </span>
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
