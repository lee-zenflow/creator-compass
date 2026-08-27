import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="legal-shell compass-surface">
      <article className="legal-document">
        <header className="legal-document__header">
          <p className="legal-coordinate">POLICY / PRIVACY</p>
          <h1>隐私说明</h1>
          <p className="legal-draft-notice" role="status">发布前待运营主体确认的说明草案</p>
          <p>本文只记录当前代码已经实现的数据处理事实，不代表已经通过法律或合规审查。运营主体、联系方式、正式生效日期及适用地区仍需在发布前确认。</p>
        </header>

        <section>
          <h2>1. 当前收集和生成的数据</h2>
          <ul>
            <li>首次设置会在本机创建唯一 Owner，并保存称呼和认证所需的密码凭据；密码只保存为安全哈希，页面不会显示密码或令牌。</li>
            <li>为完成产品功能，会保存用户主动提交的定位访谈、创作档案、创作需求、素材、确认后的复盘数据、任务和报告。</li>
            <li>产品会记录不含正文的运行与失败信息，用于排查 AI、检索、OCR 和业务流程异常。</li>
          </ul>
        </section>

        <section>
          <h2>2. OCR、截图与平台数据</h2>
          <p>OCR 默认在浏览器本地运行，截图原图默认不保存。只有用户主动选择保存时，图片才会进入 Owner 隔离的本机私有目录。当前产品不会连接内容平台、保存平台授权令牌或自动同步平台数据。</p>
        </section>

        <section>
          <h2>3. AI、邮件与基础设施</h2>
          <p>只有用户在应用内提供并测试 DeepSeek Key 后，定位、创作或复盘所需的明确输入才会发送给 DeepSeek；Key 只在本机服务端加密保存。数据库、知识文件和私有附件都保存在本机，产品不接入外部遥测。</p>
        </section>

        <section>
          <h2>4. 用户可执行的操作</h2>
          <p>产品提供可读的个人数据 JSON 导出，以及包含数据库和私有附件的密码加密备份。Owner 在确认已完成备份、输入当前密码与指定文字并二次确认后，可以恢复出厂状态；该操作清理本机产品数据和自动快照，但保留程序文件与已下载的本地模型。</p>
        </section>

        <section>
          <h2>5. 发布前仍需确认</h2>
          <p>运营主体名称、联系渠道、正式保留期限、未成年人规则、跨境处理情况、投诉渠道和文本生效日期尚未确定。缺少这些信息时，本草案不能作为正式隐私政策使用。</p>
        </section>

        <footer className="legal-document__footer">
          <Link href="/welcome">返回产品入口</Link>
          <Link href="/terms">查看用户协议草案</Link>
        </footer>
      </article>
    </main>
  );
}
