"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/Button";

/**
 * Native <dialog> overlays (showModal): the browser provides focus containment, inert page, Esc, top layer and
 * focus return to the invoker — so no role="dialog"/aria-modal/focus trap here. Backdrop click closes
 * (closedby="any", with a pointer fallback where unsupported).
 */
type Variant = "modal" | "drawer";

const BASE =
  "m-0 max-h-none max-w-none bg-transparent p-0 text-ink [overscroll-behavior:contain] backdrop:overflow-hidden backdrop:bg-ink/40 backdrop:[overscroll-behavior:contain] open:flex";
const PANEL: Record<Variant, string> = {
  modal: "fixed inset-0 m-auto h-fit max-h-[min(88vh,760px)] w-[min(92vw,var(--w))] flex-col rounded-xl border border-ink-line/80 bg-white shadow-card",
  drawer: "fixed inset-y-0 left-auto right-0 h-full max-h-none w-[min(100vw,var(--w))] flex-col border-l border-ink-line/80 bg-white shadow-card",
};

function outside(e: React.PointerEvent, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: Variant;
  /** CSS width, e.g. "520px" (modal default) or "560px" (drawer default). */
  width?: string;
  /** Allow backdrop click to dismiss (default true). Esc always works. */
  lightDismiss?: boolean;
  className?: string;
};

/** Controlled modal or right-side drawer. */
export function Dialog({ open, onClose, title, description, children, footer, variant = "modal", width, lightDismiss = true, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const pressedOutside = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const nativeClosedBy = typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // closedby is newer than React's typings
      {...({ closedby: lightDismiss ? "any" : "closerequest" } as Record<string, string>)}
      onClose={onClose}
      onPointerDown={(e) => {
        pressedOutside.current = !nativeClosedBy && lightDismiss && outside(e, e.currentTarget);
      }}
      onPointerUp={(e) => {
        if (pressedOutside.current && outside(e, e.currentTarget)) e.currentTarget.close();
        pressedOutside.current = false;
      }}
      style={{ ["--w" as string]: width ?? (variant === "drawer" ? "560px" : "520px") }}
      className={cn(BASE, PANEL[variant], className)}
    >
      {open && (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-ink-line/60 px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-base font-bold text-ink">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-ink-mute">
                  {description}
                </p>
              )}
            </div>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="-mr-1 rounded-md p-1.5 text-ink-mute hover:bg-ink/5 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-akash">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-line/60 px-5 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Uncontrolled: a trigger button that opens a modal or drawer. */
export function DialogTrigger({
  label,
  triggerClassName,
  variant = "modal",
  children,
  ...rest
}: Omit<DialogProps, "open" | "onClose" | "children"> & { label: React.ReactNode; triggerClassName?: string; children: React.ReactNode | ((close: () => void) => React.ReactNode) }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className={triggerClassName ?? buttonClass("outline", "sm")} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {label}
      </button>
      <Dialog {...rest} variant={variant} open={open} onClose={close}>
        {typeof children === "function" ? children(close) : children}
      </Dialog>
    </>
  );
}

/** Right-side drawer with a trigger (record previews, quick edits). */
export function Drawer(props: Omit<Parameters<typeof DialogTrigger>[0], "variant">) {
  return <DialogTrigger {...props} variant="drawer" />;
}

type ActionLike = (fd: FormData) => Promise<{ ok: boolean; message?: string } | void>;

/**
 * Confirmation for bulk or destructive operations. Renders a trigger; the dialog states how many records are
 * affected and, for large or irreversible changes, asks the user to type a word before the confirm button enables.
 * Hidden `ids` inputs (one per id) plus `fields` are posted to `action`.
 */
export function ConfirmDialog({
  action,
  ids = [],
  fields = {},
  label,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  requireText,
  disabled,
  reasonLabel,
  triggerVariant = "outline",
}: {
  action: ActionLike;
  ids?: string[];
  fields?: Record<string, string>;
  label: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  /** If set, the user must type this (e.g. "DELETE" or the count) to enable confirm. */
  requireText?: string;
  disabled?: boolean;
  /** Ask for a reason (posted as `reason`; required, ≥3 chars). */
  reasonLabel?: string;
  triggerVariant?: Parameters<typeof buttonClass>[0];
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const errId = useId();
  const typedId = useId();
  const reasonId = useId();
  const blocked = Boolean(requireText && typed.trim() !== requireText);
  const count = ids.length;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className={buttonClass(triggerVariant, "sm")}
        onClick={() => {
          setTyped("");
          setError(null);
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        lightDismiss={!pending}
        description={count ? `This affects ${count} record${count === 1 ? "" : "s"}.` : undefined}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (blocked) return;
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const res = await action(fd);
              if (res && !res.ok) {
                setError(res.message ?? "That didn't work");
                return;
              }
              setOpen(false);
              router.refresh();
            });
          }}
          className="space-y-3"
        >
          {description && <div className="text-ink-soft">{description}</div>}
          {ids.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {reasonLabel && (
            <div>
              <label htmlFor={reasonId} className="mb-1 block text-xs font-semibold text-ink-soft">
                {reasonLabel}
              </label>
              <textarea id={reasonId} name="reason" required minLength={3} maxLength={500} rows={2} className="field" />
            </div>
          )}
          {requireText && (
            <div>
              <label htmlFor={typedId} className="mb-1 block text-xs font-semibold text-ink-soft">
                Type <span className="font-mono font-bold text-ink">{requireText}</span> to confirm
              </label>
              <input id={typedId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="field" aria-describedby={error ? errId : undefined} />
            </div>
          )}
          <p id={errId} role="alert" className={cn("text-sm text-sindoor-dark", !error && "sr-only")}>
            {error ?? ""}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" autoFocus className={buttonClass("outline", "sm")} onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </button>
            <button type="submit" disabled={blocked || pending} className={buttonClass(tone === "danger" ? "danger" : "primary", "sm")}>
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
