import Link from "next/link";

export default function NotFound() {
  return (
    <main className="brand-state">
      <span aria-hidden="true" className="brand-state__mark">CC</span>
      <h1>页面没有找到</h1>
      <p>这个入口可能已经更新，你可以回到当前工作台继续。</p>
      <Link className="compact-button" href="/workspace">返回工作台</Link>
    </main>
  );
}
