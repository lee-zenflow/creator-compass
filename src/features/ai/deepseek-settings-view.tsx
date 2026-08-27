import { ModuleIcon } from "@/components/ui/module-icon";
import type { DeepSeekRunUsage } from "./deepseek-settings-service";

const taskLabels: Record<DeepSeekRunUsage["taskType"], string> = {
  profile_extract: "画像提取",
  positioning_report: "IP 定位",
  content_plan: "事前创作",
  review_report: "数据复盘",
};

type DeepSeekStatus =
  | {
      configured: false;
      monthlyUsage: { inputTokens: number; outputTokens: number };
      recentUsage: DeepSeekRunUsage[];
    }
  | {
      configured: true;
      lastFour: string;
      testedAt: Date | null;
      monthlyUsage: { inputTokens: number; outputTokens: number };
      recentUsage: DeepSeekRunUsage[];
    };

type FormAction = (formData: FormData) => void | Promise<void>;

export function DeepSeekSettingsView({
  status,
  saveAction,
  revokeAction,
}: {
  status: DeepSeekStatus;
  saveAction: FormAction;
  revokeAction: FormAction;
}) {
  return (
    <div className="settings-surface">
      <section className="compact-section settings-section">
        <div className="profile-version">
          <ModuleIcon name="ai" label="DeepSeek" />
          <span className="tool-row__copy">
            <strong>DeepSeek · deepseek-v4-flash</strong>
            <small>
              {status.configured
                ? `已配置 · 末四位 ${status.lastFour}`
                : "尚未配置 · AI 功能当前不可用"}
            </small>
          </span>
        </div>
        {status.configured && status.testedAt ? (
          <p className="compact-message">
            最近测试：{status.testedAt.toLocaleString("zh-CN", { hour12: false })}
          </p>
        ) : null}
      </section>

      <section className="compact-section settings-section">
        <div className="section-heading"><h2>本月 Token</h2></div>
        <div className="compact-stats-grid">
          <div><strong>{status.monthlyUsage.inputTokens.toLocaleString("zh-CN")}</strong><small>输入 Token</small></div>
          <div><strong>{status.monthlyUsage.outputTokens.toLocaleString("zh-CN")}</strong><small>输出 Token</small></div>
        </div>
        <p className="compact-message">只展示 DeepSeek 返回的 Token 数，不估算人民币费用。</p>
      </section>

      <section className="compact-section settings-section">
        <div className="section-heading"><h2>最近 5 次调用</h2></div>
        {status.recentUsage.length ? (
          <div className="compact-list">
            {status.recentUsage.map((usage) => (
              <div className="tool-row" key={usage.runId}>
                <ModuleIcon name="ai" label={taskLabels[usage.taskType]} />
                <span className="tool-row__copy">
                  <strong>{taskLabels[usage.taskType]}</strong>
                  <small>输入 {usage.inputTokens.toLocaleString("zh-CN")} · 输出 {usage.outputTokens.toLocaleString("zh-CN")}</small>
                </span>
                <time dateTime={usage.createdAt.toISOString()}>
                  {usage.createdAt.toLocaleDateString("zh-CN")}
                </time>
              </div>
            ))}
          </div>
        ) : <p className="compact-empty">还没有真实调用记录。</p>}
      </section>

      <section className="compact-section settings-section">
        <div className="section-heading"><h2>{status.configured ? "测试并替换 Key" : "配置 Key"}</h2></div>
        <form action={saveAction} className="compact-form">
          <label>
            DeepSeek API Key
            <input name="apiKey" type="password" autoComplete="off" placeholder="sk-…" required />
          </label>
          <label className="compact-consent-row">
            <input name="consent" type="checkbox" value="yes" required />
            <span>我确认本次会把明确列出的内容发送给 DeepSeek；Key 仅在本机加密保存。</span>
          </label>
          <button className="compact-button" type="submit">测试并保存</button>
        </form>
      </section>

      {status.configured ? (
        <section className="compact-section settings-section account-danger-zone">
          <div className="section-heading"><h2>撤销凭据</h2></div>
          <p className="compact-message">撤销后立即销毁密文，所有 AI 入口停止生成，已有报告不受影响。</p>
          <form action={revokeAction}>
            <button className="compact-button compact-button--secondary" type="submit">
              撤销并销毁 Key
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
