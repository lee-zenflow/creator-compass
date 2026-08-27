import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { updateProfileAction } from "@/features/positioning/positioning-actions";
import { getActiveCreatorProfile } from "@/features/positioning/positioning-read-service";
import { OfflineDraftForm } from "@/components/offline-draft-form";
import { ModuleIcon } from "@/components/ui/module-icon";

export default async function CreatorProfilePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  const profile = await getActiveCreatorProfile(actor);
  const notice = (await searchParams).notice;
  return (
    <AppShell title="个人创作档案" backHref="/me" bottomNav={false}>
      <div className="flow-content compact-page profile-page">
        {!profile ? (
          <div className="compact-empty">还没有已确认的定位。<br /><Link href="/positioning">开始 0-1 IP 定位</Link></div>
        ) : (
          <OfflineDraftForm className="compact-card profile-editor instrument-panel" action={updateProfileAction} baseVersion={profile.version} draftId={`profile:${profile.id}`} entityId={profile.id} entityType="profile">
            <div className="profile-version"><ModuleIcon name="profile" label="个人创作档案" /><span className="tool-row__copy"><strong>当前版本 V{profile.version}</strong><small>更新于 {profile.updatedAt.toLocaleDateString("zh-CN")}</small></span></div>
            <input type="hidden" name="expectedVersion" value={profile.version} />
            <label>当前定位<input name="currentPositioning" defaultValue={profile.currentPositioning ?? ""} required /></label>
            <label>目标人群<textarea name="targetAudience" defaultValue={profile.targetAudience ?? ""} required rows={3} /></label>
            <label>内容方向<textarea name="contentDirection" defaultValue={profile.contentDirection ?? ""} required rows={4} /></label>
            {notice === "saved" ? <p className="compact-message">档案已保存为新版本。</p> : notice === "conflict" ? <p className="compact-message" data-error="true">内容已在其他页面更新，请刷新后重试。</p> : notice ? <p className="compact-message" data-error="true">保存失败，现有内容已保留，请重试。</p> : null}
            <button className="compact-button" type="submit">保存新版本</button>
          </OfflineDraftForm>
        )}
      </div>
    </AppShell>
  );
}
