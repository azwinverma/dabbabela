"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";

/** One-click server action button with a confirm dialog. `action` is a bound server action returning ActionResult-like. */
export function ConfirmAction({
  action,
  label,
  confirm,
  variant = "outline",
  size = "sm",
  className,
}: {
  action: () => Promise<{ ok: boolean; message?: string } | void>;
  label: React.ReactNode;
  confirm?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  className?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await action();
          if (res && !res.ok && res.message) window.alert(res.message);
          router.refresh();
        });
      }}
    >
      {pending ? "Working…" : label}
    </button>
  );
}
