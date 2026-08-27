import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { createCreationProjectAction } from "@/features/creation/creation-actions";
import { OfflineDraftForm } from "@/components/offline-draft-form";

export default async function NewCreationPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  try { await resolveCurrentActor(await headers(), await cookies()); } catch { redirect(HOME_REDIRECT_TARGET); }
  const query = await searchParams;
  return (
    <AppShell title="事前创作" backHref="/tools" bottomNav={false} stickyFooter={<button className="compact-button" form="creation-request" type="submit">选择参考素材</button>}>
      <OfflineDraftForm action={createCreationProjectAction} baseVersion={0} className="flow-content compact-form" draftId="creation:new" entityId="new" entityType="creation" id="creation-request">
        <nav className="compact-segmented" aria-label="内容类型">
          <label className="compact-segmented__item"><input defaultChecked name="contentType" type="radio" value="article" />图文</label>
          <label className="compact-segmented__item"><input name="contentType" type="radio" value="video" />视频</label>
          <label className="compact-segmented__item"><input name="contentType" type="radio" value="copy" />文案</label>
        </nav>
        <label>目标平台<select name="platform" defaultValue="小红书" required><option>小红书</option><option>抖音</option><option>B站</option><option>公众号</option><option>其他</option></select></label>
        <label>本轮创作目标<textarea name="goal" rows={3} maxLength={2000} placeholder="这次想解决什么问题、让谁看完做什么" required /></label>
        <label>补充要求<textarea name="requirements" rows={3} maxLength={4000} placeholder="语气、篇幅、必须包含或避开的内容（可选）" /></label>
        <label>可用时间（分钟）<input name="availableMinutes" type="number" min={15} max={10080} defaultValue={60} /></label>
        {query.notice ? <p className="compact-message" data-error="true">需求未保存，请检查必填内容。</p> : null}
      </OfflineDraftForm>
    </AppShell>
  );
}
