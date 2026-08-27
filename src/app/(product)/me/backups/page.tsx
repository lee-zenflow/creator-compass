import { AppShell } from "@/components/app-shell/app-shell";
import { ModuleIcon } from "@/components/ui/module-icon";

const notices: Record<string, { message: string; error?: boolean }> = {
  restored: { message: "备份已恢复。为保护隐私，DeepSeek Key 已清除，请重新填写。" },
  limited: { message: "操作过于频繁，请稍后再试。", error: true },
  "restore-failed": { message: "未能恢复：请检查备份文件和密码，原数据已保持或回滚。", error: true },
};

export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const notice = notices[(await searchParams).notice ?? ""];
  return (
    <AppShell title="备份与恢复" backHref="/me/settings" bottomNav={false}>
      <div className="flow-content compact-page settings-surface backup-surface">
        <header className="compact-intro-row">
          <ModuleIcon name="backup" label="备份" />
          <div><strong>把完整闭环留在自己手里</strong><small>数据库与私有附件一起加密，只保存到你选择的位置</small></div>
        </header>
        {notice ? <p className="compact-message" role="status" data-error={notice.error || undefined}>{notice.message}</p> : null}
        <section className="compact-section settings-section">
          <div className="section-heading"><h2>导出可恢复备份</h2><small>推荐每周一次</small></div>
          <p className="compact-message">包含定位、创作、素材、复盘、任务、知识库和本地统计；不包含登录密码、恢复码、会话、主密钥与 DeepSeek Key。</p>
          <form action="/api/maintenance/backups" method="post" className="compact-form">
            <label>备份密码<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label>
            <label>再次输入<input name="passwordConfirmation" type="password" minLength={10} autoComplete="new-password" required /></label>
            <button className="compact-button" type="submit">生成并下载 .ccbackup</button>
          </form>
        </section>
        <section className="compact-section settings-section">
          <div className="section-heading"><h2>恢复备份</h2><small>先校验，再替换</small></div>
          <p className="compact-message">恢复前会自动保存当前状态。校验或恢复失败时不会留下半套数据；成功后需要重新填写 DeepSeek Key。</p>
          <form action="/api/maintenance/backups/restore" method="post" encType="multipart/form-data" className="compact-form">
            <label>选择备份文件<input name="backup" type="file" accept=".ccbackup,application/octet-stream" required /></label>
            <label>备份密码<input name="password" type="password" minLength={10} autoComplete="current-password" required /></label>
            <button className="compact-button compact-button--secondary" type="submit">校验并恢复</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
