"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui/primitives";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary", "sm", "no-print")}>
      <Printer className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  );
}
