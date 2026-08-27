import {
  createPlatformAccountAction,
  setActivePlatformAccountAction,
} from "./platform-account-actions";

const platformLabels: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  wechat: "公众号",
  other: "其他",
};

export type PlatformAccountLabelView = {
  id: string;
  platform: string;
  accountLabel: string | null;
  dataSource: string;
  isActive: boolean;
};

export function PlatformAccountsView({ accounts, next, notice }: {
  accounts: PlatformAccountLabelView[];
  next: string;
  notice: string | null;
}) {
  return (
    <div className="platform-accounts-view">
      <p className="compact-message platform-capability-note">
        这里只保存平台和账号标签，不会连接平台、保存授权令牌或自动同步数据。
      </p>
      <div className="compact-stack">
        {accounts.length ? accounts.map((account) => (
          <div className="platform-account-row compact-card" key={account.id}>
            <span>
              <strong>{account.accountLabel ?? platformLabels[account.platform] ?? account.platform}</strong>
              <small>
                {platformLabels[account.platform] ?? account.platform} · {account.dataSource === "ocr" ? "截图 OCR" : "手动录入"}
              </small>
            </span>
            {account.isActive ? (
              <b>当前标签</b>
            ) : (
              <form action={setActivePlatformAccountAction}>
                <input name="accountId" type="hidden" value={account.id} />
                <input name="next" type="hidden" value={next} />
                <button className="compact-text-action" type="submit">设为当前标签</button>
              </form>
            )}
          </div>
        )) : <p className="compact-empty">还没有账号标签，可以先添加一个用于区分复盘数据。</p>}
      </div>
      <form action={createPlatformAccountAction} className="compact-form platform-account-form">
        <input name="next" type="hidden" value={next} />
        <label>
          平台
          <select name="platform">
            <option value="xiaohongshu">小红书</option>
            <option value="douyin">抖音</option>
            <option value="bilibili">B站</option>
            <option value="wechat">公众号</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>账号标签<input name="accountLabel" placeholder="例如：主账号" required /></label>
        <label>
          数据来源
          <select name="dataSource">
            <option value="ocr">截图 OCR</option>
            <option value="manual">手动录入</option>
          </select>
        </label>
        <button className="compact-button" type="submit">添加账号标签</button>
      </form>
      {notice ? <p className="compact-message" data-error="true">操作未完成，请检查输入。</p> : null}
    </div>
  );
}
