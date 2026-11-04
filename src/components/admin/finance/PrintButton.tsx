"use client";
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="h-9 rounded-xl border-2 border-ink px-3 text-sm font-semibold hover:bg-ink hover:text-paper print:hidden">
      {label}
    </button>
  );
}
