import { BadgeCheck, BookOpenText, Database, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getKnowledgeOverview } from "@/features/admin/admin-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";

export default async function AdminPage() {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");
  const overview = await getKnowledgeOverview(actor);
  const metrics = [
    { label: "知识来源", value: overview.sources, note: "已入库来源总数", icon: Database },
    { label: "待审来源", value: overview.pendingSources, note: "完成处理后可审核", icon: BookOpenText },
    { label: "知识切片", value: overview.chunks, note: `${overview.pendingChunks} 条等待切片审核`, icon: BadgeCheck },
    { label: "处理失败", value: overview.failedSources, note: "只展示安全错误状态", icon: ShieldAlert },
  ];
  return <div className="admin-page">
    <section className="admin-page-heading"><div><p>RAG KNOWLEDGE OPERATIONS</p><h2>知识概览</h2><span>监控从来源入库、AI 结构化、双重审核到生产检索的真实状态。</span></div><Link className="admin-button" href="/admin/knowledge">管理知识来源</Link></section>
    <section className="admin-metric-grid">{metrics.map(({ label, value, note, icon: Icon }) => <article className="admin-metric" key={label}><span className="admin-metric__icon"><Icon aria-hidden="true" size={19} strokeWidth={1.8} /></span><div><small>{label}</small><strong>{value.toLocaleString("zh-CN")}</strong><p>{note}</p></div></article>)}</section>
    <section className="admin-overview-grid">
      <article className="admin-panel admin-process"><div className="admin-section-heading"><div><h2>生产检索门槛</h2><p>每一步都来自数据库状态，不用演示数据补齐。</p></div></div><ol><li><span>01</span><div><strong>来源处理</strong><small>抓取或解析、切片、AI 标签化</small></div></li><li><span>02</span><div><strong>来源审核</strong><small>确认授权、出处与整体可用性</small></div></li><li><span>03</span><div><strong>切片审核</strong><small>逐条确认内容、标签与检索范围</small></div></li><li><span>04</span><div><strong>生产检索</strong><small>仅双审通过且启用的切片可命中</small></div></li></ol></article>
      <article className="admin-panel admin-review-brief"><div className="admin-section-heading"><div><h2>当前待办</h2><p>先处理会阻塞生产检索的事项。</p></div></div><Link href="/admin/knowledge?view=review"><span><BadgeCheck aria-hidden="true" size={18} /><strong>{overview.pendingSources} 个来源待审核</strong></span><b>查看</b></Link><Link href="/admin/knowledge?view=review"><span><BookOpenText aria-hidden="true" size={18} /><strong>{overview.pendingChunks} 条切片待审核</strong></span><b>查看</b></Link>{overview.failedSources > 0 ? <Link data-tone="danger" href="/admin/knowledge"><span><ShieldAlert aria-hidden="true" size={18} /><strong>{overview.failedSources} 个来源处理失败</strong></span><b>排查</b></Link> : <p className="admin-inline-message" data-tone="success">当前没有来源处理失败。</p>}</article>
    </section>
  </div>;
}
