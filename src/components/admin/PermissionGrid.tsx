import { ACTIONS, ACTION_LABEL, MODULE_GROUPS, REGISTRY, type Action, type Module } from "@/lib/permissions/registry";
import { cn } from "@/lib/utils";

const USED_ACTIONS: Action[] = ACTIONS.filter((a) => Object.values(REGISTRY).some((m) => (m.actions as readonly string[]).includes(a)));

/**
 * Module × action grid. Editable mode renders checkboxes named `perm` (value "module.action").
 * `inherited` marks permissions that come from the base role (shown ticked + locked).
 */
export function PermissionGrid({
  checked,
  inherited,
  editable = false,
  name = "perm",
}: {
  checked: ReadonlySet<string>;
  inherited?: ReadonlySet<string>;
  editable?: boolean;
  name?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-xs">
        <thead>
          <tr className="bg-paper/60 text-ink-mute">
            <th scope="col" className="sticky left-0 bg-paper px-3 py-2 text-left font-bold uppercase tracking-wide">Module</th>
            {USED_ACTIONS.map((a) => (
              <th key={a} scope="col" className="px-1.5 py-2 text-center font-semibold">
                {ACTION_LABEL[a]}
              </th>
            ))}
          </tr>
        </thead>
        {MODULE_GROUPS.map((group) => (
          <tbody key={group}>
            <tr>
              <th colSpan={USED_ACTIONS.length + 1} scope="colgroup" className="border-t border-ink-line/60 bg-paper/40 px-3 pb-1 pt-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-mute">
                {group}
              </th>
            </tr>
            {(Object.keys(REGISTRY) as Module[])
              .filter((m) => REGISTRY[m].group === group)
              .map((m) => (
                <tr key={m} className="border-t border-ink-line/30">
                  <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-medium text-ink">
                    {REGISTRY[m].label}
                    <span className="ml-1.5 font-mono text-[10px] text-ink-mute">{m}</span>
                  </th>
                  {USED_ACTIONS.map((a) => {
                    if (!(REGISTRY[m].actions as readonly string[]).includes(a)) return <td key={a} className="text-center text-ink-line" aria-hidden="true">–</td>;
                    const key = `${m}.${a}`;
                    const fromBase = inherited?.has(key) ?? false;
                    const on = checked.has(key) || fromBase;
                    const label = `${REGISTRY[m].label}: ${ACTION_LABEL[a]}`;
                    return (
                      <td key={a} className="text-center">
                        {editable ? (
                          <input
                            type="checkbox"
                            name={fromBase ? undefined : name}
                            value={key}
                            defaultChecked={on}
                            disabled={fromBase}
                            aria-label={label}
                            title={fromBase ? "Comes with the base role" : label}
                            className="h-4 w-4 rounded border-ink-line accent-sindoor disabled:opacity-50"
                          />
                        ) : (
                          <span className={cn("font-bold", on ? (fromBase && !checked.has(key) ? "text-ink-mute" : "text-saag") : "text-ink-line")} aria-label={on ? `${label}: yes` : `${label}: no`}>
                            {on ? "●" : "·"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Compact grouped list of permissions, e.g. for a staff member's effective access. */
export function PermissionSummary({ perms }: { perms: readonly string[] }) {
  const set = new Set(perms);
  const rows = (Object.keys(REGISTRY) as Module[])
    .map((m) => ({ m, actions: (REGISTRY[m].actions as readonly Action[]).filter((a) => set.has(`${m}.${a}`)) }))
    .filter((r) => r.actions.length);
  if (!rows.length) return <p className="text-sm text-ink-mute">No control-room access.</p>;
  return (
    <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
      {rows.map((r) => (
        <li key={r.m} className="flex justify-between gap-3 border-b border-ink-line/30 py-1">
          <span className="font-medium">{REGISTRY[r.m].label}</span>
          <span className="text-right text-ink-mute">{r.actions.map((a) => ACTION_LABEL[a]).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}
