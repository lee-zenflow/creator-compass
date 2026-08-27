import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="legal-shell compass-surface">
      <article className="legal-document">
        <header className="legal-document__header">
          <p className="legal-coordinate">POLICY / TERMS</p>
          <h1>用户协议</h1>
          <p className="legal-draft-notice" role="status">发布前待运营主体确认的说明草案</p>
          <p>本文用于说明当前产品能力和使用边界，不代表已经通过法律或合规审查。运营主体、联系方式、正式生效日期和争议处理方式仍需发布前确认。</p>
        </header>

        <section>
          <h2>1. 产品范围</h2>
          <p>Creator Compass 提供定位访谈、创作方案、浏览器本地 OCR、数据复盘、任务、素材、报告和个人数据管理。当前版本不提供平台授权、自动抓取、支付或短信能力。</p>
        </section>

        <section>
          <h2>2. AI 输出边界</h2>
          <p>AI 结果属于创作决策辅助建议，不保证准确、完整或适合直接发布。用户需要核对候选定位、引用、内容方案、数据识别结果和执行任务后再确认使用。没有匹配知识依据时，产品应明确提示，不会把开发示例当成真实案例。</p>
        </section>

        <section>
          <h2>3. 账号与游客体验</h2>
          <p>用户应提供自己有权使用的邮箱并妥善保护账号。游客身份用于短期体验，最长保留 30 天；验证邮箱后可以把游客数据合并到正式账号。不得尝试访问其他用户数据、绕过权限、破坏服务或提交攻击性内容。</p>
        </section>

        <section>
          <h2>4. 用户提交内容</h2>
          <p>用户应确保上传或填写的素材、截图、文字和数据拥有合法来源，不侵犯他人知识产权、隐私或其他权益。请勿提交不必要的身份证件、金融账户、医疗信息或其他敏感个人信息。</p>
        </section>

        <section>
          <h2>5. 数据导出与账号删除</h2>
          <p>当前产品提供个人数据导出和正式账号删除。账号删除不可撤销，并要求近期重新登录及明确确认文字。具体运营主体、服务可用性承诺、责任范围、终止规则和争议处理条款仍待发布前确认。</p>
        </section>

        <footer className="legal-document__footer">
          <Link href="/welcome">返回产品入口</Link>
          <Link href="/privacy">查看隐私说明草案</Link>
        </footer>
      </article>
    </main>
  );
}
