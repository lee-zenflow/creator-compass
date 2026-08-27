"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function ReportSubmitButton({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-busy={pending || undefined}
      aria-label={label}
      className="compact-icon-action"
      disabled={pending}
      type="submit"
    >
      {children}
    </button>
  );
}
