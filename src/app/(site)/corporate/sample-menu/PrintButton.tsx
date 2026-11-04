"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("dark", "sm")}>
      <Printer className="h-4 w-4" aria-hidden /> Print / save PDF
    </button>
  );
}
