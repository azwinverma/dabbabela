/** Kitchen picker for inventory pages; only shown when the user can see more than one kitchen. */
export function KitchenSwitch({ kitchens, current, extra }: { kitchens: { id: string; name: string }[]; current: string; extra?: Record<string, string | undefined> }) {
  if (kitchens.length < 2) return null;
  return (
    <form className="mb-3 flex gap-2">
      {Object.entries(extra ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <select name="kitchen" defaultValue={current} className="field w-52" aria-label="Kitchen">
        {kitchens.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
      <button className="rounded-lg bg-ink px-3 text-sm font-semibold text-paper">Switch</button>
    </form>
  );
}
