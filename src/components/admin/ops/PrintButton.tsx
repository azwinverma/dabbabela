"use client";
import { buttonClass } from "@/components/ui/Button";

export function PrintButton({ label = "Print", onPrint }: { label?: string; onPrint?: () => void }) {
  return (
    <button type="button" className={buttonClass("outline", "sm", "no-print")} onClick={() => { onPrint?.(); window.print(); }}>
      {label}
    </button>
  );
}
