"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { Dialog } from "@/components/admin/Dialog";
import { initialAction, type ActionResult } from "@/lib/action";
import { acknowledgeAlertsAction, assignAlertsAction, reopenAlertAction, resolveAlertsAction, runDetectorsAction, saveEscalationAction } from "./actions";

type Assignee = { id: string; name: string };
type Op = "ack" | "assign" | "resolve";
const SELECT = "input[data-alert-select]";

const OP_LABEL: Record<Op, string> = { ack: "Acknowledge", assign: "Assign", resolve: "Resolve" };
const OP_ACTION: Record<Op, (fd: FormData) => Promise<ActionResult>> = { ack: acknowledgeAlertsAction, assign: assignAlertsAction, resolve: resolveAlertsAction };

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const router = useRouter();
  const run = (action: (fd: FormData) => Promise<ActionResult>, fd: FormData, onOk?: () => void) =>
    start(async () => {
      const res = await action(fd);
      setMsg(res);
      if (res.ok) {
        onOk?.();
        router.refresh();
      }
    });
  return { pending, msg, run, setMsg };
}

function Message({ msg }: { msg: ActionResult | null }) {
  return (
    <p role="status" className={msg ? (msg.ok ? "text-xs text-saag-dark" : "text-xs text-sindoor-dark") : "sr-only"}>
      {msg?.message ?? ""}
    </p>
  );
}

function AssigneeSelect({ id, assignees, defaultValue }: { id: string; assignees: Assignee[]; defaultValue?: string | null }) {
  return (
    <select id={id} name="ownerId" defaultValue={defaultValue ?? ""} className="field">
      <option value="">Unassigned</option>
      {assignees.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

/** Bulk actions over the ticked rows, each behind a confirmation dialog stating how many alerts change. */
export function BulkBar({ assignees }: { assignees: Assignee[] }) {
  const [ids, setIds] = useState<string[]>([]);
  const [op, setOp] = useState<Op | null>(null);
  const { pending, msg, run, setMsg } = useRun();
  const noteId = useId();
  const ownerId = useId();
  const allId = useId();

  useEffect(() => {
    const sync = () => setIds([...document.querySelectorAll<HTMLInputElement>(SELECT)].filter((i) => i.checked).map((i) => i.value));
    document.addEventListener("change", sync);
    sync();
    return () => document.removeEventListener("change", sync);
  }, []);

  const open = (o: Op) => {
    setMsg(null);
    setOp(o);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-ink-line/70 bg-white/70 px-3 py-2 text-sm">
      <label htmlFor={allId} className="flex items-center gap-2 font-medium">
        <input
          id={allId}
          type="checkbox"
          onChange={(e) => {
            for (const i of document.querySelectorAll<HTMLInputElement>(SELECT)) i.checked = e.target.checked;
            setIds(e.target.checked ? [...document.querySelectorAll<HTMLInputElement>(SELECT)].map((i) => i.value) : []);
          }}
        />
        Select all on this page
      </label>
      <span className="text-ink-mute" aria-live="polite">
        {ids.length} selected
      </span>
      {(["ack", "assign", "resolve"] as Op[]).map((o) => (
        <button key={o} type="button" disabled={!ids.length} className={buttonClass("outline", "sm")} onClick={() => open(o)}>
          {OP_LABEL[o]}…
        </button>
      ))}
      <Dialog open={op !== null} onClose={() => setOp(null)} title={op ? `${OP_LABEL[op]} ${ids.length} alert${ids.length === 1 ? "" : "s"}` : ""} description={`This affects ${ids.length} alert${ids.length === 1 ? "" : "s"}. Each change is recorded in the audit log.`} lightDismiss={!pending}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!op) return;
            const fd = new FormData(e.currentTarget);
            for (const id of ids) fd.append("ids", id);
            run(OP_ACTION[op], fd, () => setOp(null));
          }}
        >
          {op === "assign" && (
            <div>
              <label htmlFor={ownerId} className="mb-1 block text-xs font-semibold text-ink-soft">
                Owner
              </label>
              <AssigneeSelect id={ownerId} assignees={assignees} />
            </div>
          )}
          {op === "resolve" && (
            <div>
              <label htmlFor={noteId} className="mb-1 block text-xs font-semibold text-ink-soft">
                Resolution note (what was done)
              </label>
              <textarea id={noteId} name="note" required minLength={3} maxLength={1000} rows={3} className="field" />
            </div>
          )}
          <Message msg={msg} />
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("outline", "sm")} onClick={() => setOp(null)} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={buttonClass("primary", "sm")} disabled={pending || !ids.length}>
              {pending ? "Working…" : `Confirm ${op ? OP_LABEL[op].toLowerCase() : ""}`}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Per-alert actions shown in the details drawer. */
export function AlertActions({ alert, assignees }: { alert: { id: string; status: string; ownerId: string | null }; assignees: Assignee[] }) {
  const { pending, msg, run } = useRun();
  const ownerId = useId();
  const noteId = useId();
  const withId = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    fd.append("ids", alert.id);
    return fd;
  };

  if (alert.status === "RESOLVED")
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(reopenAlertAction, withId(e.currentTarget));
        }}
      >
        <label htmlFor={noteId} className="block text-xs font-semibold text-ink-soft">
          Re-open (reason)
        </label>
        <input id={noteId} name="reason" required minLength={3} maxLength={500} className="field" />
        <button className={buttonClass("outline", "sm")} disabled={pending}>
          Re-open
        </button>
        <Message msg={msg} />
      </form>
    );

  return (
    <div className="space-y-4">
      {alert.status === "OPEN" && (
        <button type="button" className={buttonClass("dark", "sm")} disabled={pending} onClick={() => run(acknowledgeAlertsAction, (() => { const fd = new FormData(); fd.append("ids", alert.id); return fd; })())}>
          Acknowledge — I&apos;m on it
        </button>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(assignAlertsAction, withId(e.currentTarget));
        }}
      >
        <div className="min-w-[200px] flex-1">
          <label htmlFor={ownerId} className="mb-1 block text-xs font-semibold text-ink-soft">
            Owner
          </label>
          <AssigneeSelect id={ownerId} assignees={assignees} defaultValue={alert.ownerId} />
        </div>
        <button className={buttonClass("outline", "sm")} disabled={pending}>
          Assign
        </button>
      </form>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(resolveAlertsAction, withId(e.currentTarget));
        }}
      >
        <label htmlFor={noteId} className="block text-xs font-semibold text-ink-soft">
          Resolution note
        </label>
        <textarea id={noteId} name="note" required minLength={3} maxLength={1000} rows={3} className="field" placeholder="What was done (e.g. stock received, invoice paid)" />
        <button className={buttonClass("primary", "sm")} disabled={pending}>
          Resolve
        </button>
      </form>
      <Message msg={msg} />
    </div>
  );
}

export function RunDetectorsButton() {
  const { pending, msg, run } = useRun();
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className={buttonClass("outline", "sm")} disabled={pending} onClick={() => run(() => runDetectorsAction(), new FormData())}>
        {pending ? "Checking…" : "Run detectors now"}
      </button>
      <Message msg={msg} />
    </div>
  );
}

const ROLE_CHOICES: { value: string; label: string }[] = [
  { value: "OWNER", label: "Owner" },
  { value: "OPERATIONS_MANAGER", label: "Operations manager" },
  { value: "FINANCE", label: "Finance" },
];

export function EscalationForm({ rules, canEdit }: { rules: { criticalAfterMinutes: number | null; warningAfterMinutes: number | null; roles: string[]; notifyEmail: boolean }; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveEscalationAction, initialAction);
  const c = useId();
  const w = useId();
  return (
    <form action={action} className="space-y-3 text-sm">
      <fieldset disabled={!canEdit || pending} className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <div>
            <label htmlFor={c} className="mb-1 block text-xs font-semibold text-ink-soft">
              Critical: escalate after (minutes)
            </label>
            <input id={c} name="criticalAfterMinutes" type="number" min={0} max={10080} defaultValue={rules.criticalAfterMinutes ?? ""} placeholder="never" className="field w-36" />
          </div>
          <div>
            <label htmlFor={w} className="mb-1 block text-xs font-semibold text-ink-soft">
              Warning: escalate after (minutes)
            </label>
            <input id={w} name="warningAfterMinutes" type="number" min={0} max={10080} defaultValue={rules.warningAfterMinutes ?? ""} placeholder="never" className="field w-36" />
          </div>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-ink-soft">Notify when unassigned (super admins always)</legend>
          <div className="flex flex-wrap gap-3">
            {ROLE_CHOICES.map((r) => (
              <label key={r.value} className="flex items-center gap-1.5">
                <input type="checkbox" name="roles" value={r.value} defaultChecked={rules.roles.includes(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="notifyEmail" defaultChecked={rules.notifyEmail} />
          Also email the Settings notify address (unassigned alerts)
        </label>
        {canEdit && (
          <button className={buttonClass("outline", "sm")} disabled={pending}>
            {pending ? "Saving…" : "Save rules"}
          </button>
        )}
      </fieldset>
      <Message msg={state.message ? state : null} />
    </form>
  );
}
