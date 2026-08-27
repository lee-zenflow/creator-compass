import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { ModuleIcon } from "@/components/ui/module-icon";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";

export default async function MePage() {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  return (
    <AppShell title="我的" activeTab="me">
      <div className="flow-content compact-page me-menu">
        <Link className="tool-row compact-card" data-module="platforms" href="/me/platforms"><ModuleIcon name="tools" label="平台账号" /><span className="tool-row__copy"><strong>平台账号</strong><small>只管理平台和手动账号标签</small></span><b>›</b></Link>
        <Link className="tool-row compact-card" data-module="profile" href="/me/profile"><ModuleIcon name="profile" label="个人创作档案" /><span className="tool-row__copy"><strong>个人创作档案</strong><small>查看当前定位与版本</small></span><b>›</b></Link>
        <Link className="tool-row compact-card" data-module="reports" href="/reports"><ModuleIcon name="reports" label="报告记录" /><span className="tool-row__copy"><strong>报告记录</strong><small>查看定位、创作与复盘结果</small></span><b>›</b></Link>
        <Link className="tool-row compact-card" data-module="settings" href="/me/settings"><ModuleIcon name="settings" label="数据与账号" /><span className="tool-row__copy"><strong>数据与账号</strong><small>加密备份、隐私说明与恢复出厂</small></span><b>›</b></Link>
        {actor.kind === "user" && actor.role === "admin" ? <Link className="tool-row compact-card" data-module="admin" href="/admin"><ModuleIcon name="knowledge" label="运营管理" /><span className="tool-row__copy"><strong>运营管理</strong><small>知识、规则、提示词与失败任务</small></span><b>›</b></Link> : null}
      </div>
    </AppShell>
  );
}
