"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print rounded-full border-2 border-ink px-3 py-1 text-sm font-bold hover:bg-ink hover:text-paper">
      Print / save PDF
    </button>
  );
}
