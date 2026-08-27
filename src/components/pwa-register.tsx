"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { DRAFT_SUBMISSION_KEY, DraftStore } from "@/lib/offline/draft-store";

export function PwaRegister() {
  const pathname = usePathname();
  useEffect(() => {
    if (process.env.NODE_ENV === "development" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, []);
  useEffect(() => {
    const serialized = sessionStorage.getItem(DRAFT_SUBMISSION_KEY);
    if (!serialized) return;
    try {
      const submission = JSON.parse(serialized) as { draftId?: string; fromPath?: string };
      if (!submission.draftId || !submission.fromPath || submission.fromPath === pathname) return;
      void new DraftStore().remove(submission.draftId).then(() => sessionStorage.removeItem(DRAFT_SUBMISSION_KEY));
    } catch { sessionStorage.removeItem(DRAFT_SUBMISSION_KEY); }
  }, [pathname]);
  return null;
}
