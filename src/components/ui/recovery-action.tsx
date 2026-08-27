import Link from "next/link";

import { recoveryFor } from "@/features/ai/recovery-contract";

import { Button } from "./button";
import { StatusRow } from "./status-row";

type RetryAction = (formData: FormData) => void | Promise<void>;

type RecoveryActionProps = {
  code: string | null | undefined;
  safeDetail?: string | null;
  retryAction?: RetryAction;
  retryFields?: Record<string, string>;
  returnHref: string;
};

export function RecoveryAction({
  code,
  safeDetail,
  retryAction,
  retryFields = {},
  returnHref,
}: RecoveryActionProps) {
  const recovery = recoveryFor(code, safeDetail);

  return (
    <section className="recovery-action" data-recovery-code={recovery.code}>
      <StatusRow
        state="error"
        title={recovery.title}
        detail={recovery.detail}
      />
      {recovery.retryable && retryAction ? (
        <form action={retryAction}>
          {Object.entries(retryFields).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          <Button type="submit">{recovery.action}</Button>
        </form>
      ) : (
        <Link className="compact-button" data-variant="secondary" href={returnHref}>
          {recovery.action}
        </Link>
      )}
    </section>
  );
}
