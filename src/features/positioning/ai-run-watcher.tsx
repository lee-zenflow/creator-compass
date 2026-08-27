"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AiRunWatcher({ runId }: { runId: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const response = await fetch(`/api/ai-runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        const payload = await response.json() as { ok?: boolean; run?: { status?: string } };
        if (cancelled) return;
        if (payload.ok && (payload.run?.status === "ready" || payload.run?.status === "failed")) {
          router.refresh();
          return;
        }
      } catch {
        // The persisted run remains the source of truth; a later poll may recover.
      }
      if (!cancelled) timer = setTimeout(check, 1_500);
    }
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router, runId]);

  return null;
}
