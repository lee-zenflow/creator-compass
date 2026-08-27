import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

import { AppShell } from "@/components/app-shell/app-shell";
import { ModuleIcon } from "@/components/ui/module-icon";
import { factoryResetAction } from "@/features/identity/account-actions";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const query = await searchParams;
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
  return (
    <AppShell title="数据与账号" backHref="/me" bottomNav={false}>
      <div className="flow-content compact-page settings-surface">
        <Link className="tool-row compact-card" data-module="ai" href="/me/deepseek">
          <ModuleIcon name="ai" label="DeepSeek" />
          <span className="tool-row__copy"><strong>DeepSeek 与 Token</strong><small>测试、替换或撤销你的本地加密 Key</small></span>
          <b>›</b>
        </Link>
        <Link className="tool-row compact-card" data-module="backup" href="/me/backups">
          <ModuleIcon name="backup" label="备份" />
          <span className="tool-row__copy"><strong>备份与恢复</strong><small>导出加密备份，或恢复数据库与私有附件</small></span>
          <b>›</b>
        </Link>
        <section className="compact-section settings-section">
          <div className="section-heading"><h2>导出个人数据</h2></div>
          <p className="compact-message">导出创作档案、定位、创作、素材、复盘、任务、报告和设置，不包含密码、令牌或原始截图地址。</p>
          <a className="compact-button compact-button--secondary" href="/api/account/export">下载 JSON</a>
        </section>
        <section className="compact-section settings-section settings-policy-links">
          <div className="section-heading"><h2>产品说明</h2></div>
          <p className="compact-message">隐私与协议页面是发布前待运营主体确认的说明草案，不代表已经通过法律或合规审查。</p>
          <div className="legal-links"><Link href="/terms">用户协议</Link><Link href="/privacy">隐私说明</Link></div>
        </section>
        {actor.kind === "user" ? <details className="compact-disclosure settings-section account-danger-zone">
          <summary><span><strong>恢复出厂状态</strong><small>清空本机数据并返回首次设置</small></span><b>展开</b></summary>
          <p className="compact-message" data-error="true">此操作会删除 Owner、DeepSeek Key、业务数据、知识文件、向量、本地统计和自动快照；程序与已下载的本地模型保留。</p>
          {query.notice === "bad-password" ? <p className="compact-message" role="alert">当前密码不正确，未执行任何更改。</p> : null}
          {query.notice === "invalid" ? <p className="compact-message" role="alert">请完成备份确认、确认文字和二次确认。</p> : null}
          {query.notice === "reset-failed" ? <p className="compact-message" role="alert">重置失败，私有文件和快照已恢复，请稍后重试。</p> : null}
          <form action={factoryResetAction} className="compact-form">
            <label>当前密码<input name="password" type="password" autoComplete="current-password" required /></label>
            <label className="compact-check"><input name="backupAcknowledged" type="checkbox" required /><span>我已下载并妥善保存可恢复备份</span></label>
            <label>输入“恢复出厂状态”<input name="confirmation" autoComplete="off" required /></label>
            <label className="compact-check"><input name="secondConfirmation" type="checkbox" required /><span>我理解此操作将清空本机全部产品数据</span></label>
            <button className="compact-button account-danger-button" type="submit">确认恢复出厂状态</button>
          </form>
        </details> : null}
      </div>
    </AppShell>
  );
}
