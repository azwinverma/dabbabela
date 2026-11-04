import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "dark" | "outline" | "ghost" | "besar" | "danger" | "light";
type Size = "sm" | "md" | "lg";

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap",
    size === "sm" && "h-9 px-3 text-sm",
    size === "md" && "h-11 px-5 text-[0.95rem]",
    size === "lg" && "h-14 px-7 text-base",
    variant === "primary" && "border-2 border-ink bg-sindoor text-paper-card shadow-sticker hover:-translate-y-0.5 hover:shadow-sticker-lg active:translate-y-0.5 active:shadow-none",
    variant === "besar" && "border-2 border-ink bg-besar text-ink shadow-sticker hover:-translate-y-0.5 hover:shadow-sticker-lg active:translate-y-0.5 active:shadow-none",
    variant === "dark" && "border-2 border-ink bg-ink text-paper hover:bg-ink-soft",
    variant === "outline" && "border-2 border-ink bg-transparent text-ink hover:bg-ink hover:text-paper",
    variant === "light" && "border-2 border-paper bg-transparent text-paper hover:bg-paper hover:text-ink",
    variant === "ghost" && "text-ink hover:bg-ink/5",
    variant === "danger" && "border-2 border-sindoor bg-white text-sindoor hover:bg-sindoor hover:text-white",
    extra,
  );
}

export function Button({
  variant,
  size,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
