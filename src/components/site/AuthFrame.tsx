import { Splatter, Momo, Chili } from "@/components/art/Graffiti";
import { LogoMark } from "@/components/brand/Logo";

export function AuthFrame({ title, intro, children, side }: { title: string; intro?: string; children: React.ReactNode; side?: React.ReactNode }) {
  return (
    <section className="container py-10 md:py-16">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-[1.75rem] border-2 border-ink bg-paper-card shadow-sticker-lg md:grid-cols-[1fr_1.1fr]">
        <div className="wall relative hidden flex-col justify-between p-10 text-paper md:flex" aria-hidden="true">
          <Splatter color="sindoor" className="absolute -right-6 top-10 h-40 w-40 opacity-70" seed={4} />
          <LogoMark className="h-14 w-14 -rotate-6" />
          <div className="relative">
            {side ?? (
              <>
                <p className="font-marker text-3xl leading-tight text-besar">khana khanu bhayo?</p>
                <p className="mt-3 max-w-xs text-paper/75">Your lunches, plan skips, saved dabbas and receipts — in one place.</p>
              </>
            )}
          </div>
          <div className="flex items-end gap-3">
            <Momo className="h-12 w-14" />
            <Chili className="h-10 w-20" />
          </div>
        </div>
        <div className="p-6 sm:p-8 md:p-10">
          <h1 className="text-3xl font-extrabold">{title}</h1>
          {intro && <p className="mt-2 text-ink-soft">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </section>
  );
}
