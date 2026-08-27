import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import {
  revokeDeepSeekKeyAction,
  saveDeepSeekKeyAction,
} from "@/features/ai/deepseek-settings-actions";
import { getDeepSeekStatus } from "@/features/ai/deepseek-settings-service";
import { DeepSeekSettingsView } from "@/features/ai/deepseek-settings-view";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";

export default async function DeepSeekSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await resolveCurrentActor(await headers(), await cookies()).catch(() => null);
  if (!actor || actor.kind !== "user") redirect(HOME_REDIRECT_TARGET);
  const [status, query] = await Promise.all([getDeepSeekStatus(actor.userId), searchParams]);
  return (
    <AppShell title="DeepSeek" backHref="/me/settings" bottomNav={false}>
      <div className="flow-content compact-page settings-surface">
        {query.notice === "saved" ? <p className="compact-message" role="status">Key 已测试并加密保存。</p> : null}
        {query.notice === "revoked" ? <p className="compact-message" role="status">Key 已撤销并销毁。</p> : null}
        {query.notice === "test-failed" ? <p className="compact-message" data-error="true" role="alert">测试失败。请检查 Key、网络和 DeepSeek 服务状态。</p> : null}
        <DeepSeekSettingsView status={status} saveAction={saveDeepSeekKeyAction} revokeAction={revokeDeepSeekKeyAction} />
      </div>
    </AppShell>
  );
}
