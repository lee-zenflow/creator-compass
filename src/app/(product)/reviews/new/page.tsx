import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { AiSendDisclosure } from "@/components/ui/ai-send-disclosure";
import { buildDraftReviewDisclosure } from "@/features/ai/send-disclosure";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { OcrConfirmation } from "@/features/reviews/ocr-confirmation";
import { confirmReviewMetricsAction } from "@/features/reviews/review-actions";
import { reviewPlatformSchema } from "@/features/reviews/review-schemas";
import { listPlatformAccountLabels } from "@/features/workspace/platform-account-service";

export default async function NewReviewPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); } catch { redirect(HOME_REDIRECT_TARGET); }
  const rawAccounts = await listPlatformAccountLabels(actor);
  if (!rawAccounts.length) redirect("/me/platforms?next=/reviews/new");
  const accounts = rawAccounts.map((account) => ({ ...account, platform: reviewPlatformSchema.parse(account.platform) }));
  const query = await searchParams;
  return <AppShell title="数据复盘" backHref="/tools" bottomNav={false}><div className="flow-content compact-form"><AiSendDisclosure disclosure={buildDraftReviewDisclosure()} title="确认数据后将生成复盘" /><OcrConfirmation accounts={accounts} confirmAction={confirmReviewMetricsAction} />{query.notice ? <p className="compact-message" data-error="true">{query.notice === "rate-limited" ? "操作过于频繁，请稍后再试。" : "请检查必填内容和数据格式。"}</p> : null}</div></AppShell>;
}
