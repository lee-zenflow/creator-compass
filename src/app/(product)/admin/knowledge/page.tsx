import { FileText, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminTable } from "@/components/admin/admin-table";
import { KnowledgeUploadForm } from "@/components/admin/knowledge-upload-form";
import { importKnowledgeAction } from "@/features/admin/admin-actions";
import { listKnowledgeSources, type AdminKnowledgeSource } from "@/features/admin/admin-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";

const SOURCE_TYPE_LABELS: Record<string, string> = { public_web: "网页", uploaded_file: "文件", manual_text: "手动文本" };
const STATUS_LABELS: Record<string, string> = { pending: "待处理", fetched: "已处理", failed: "失败", approved: "已通过", rejected: "已拒绝", queued: "排队中", fetching: "抓取中", parsing: "解析中", tagging: "标注中", pending_review: "待审核" };

function statusLabel(value: string | null) { return value ? STATUS_LABELS[value] ?? value : "—"; }
function formatDate(value: Date) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(value); }

export default async function KnowledgeAdminPage({ searchParams }: { searchParams: Promise<{ notice?: string; view?: string }> }) {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");
  const query = await searchParams;
  const reviewOnly = query.view === "review";
  const sourceWindow = await listKnowledgeSources(actor, { reviewOnly });
  const sources = sourceWindow.rows;
  return <div className="admin-page">
    <section className="admin-page-heading"><div><p>KNOWLEDGE SOURCES</p><h2>{reviewOnly ? "审核队列" : "知识来源"}</h2><span>{reviewOnly ? `数据库内共有 ${sourceWindow.total} 个待审核来源；当前窗口展示 ${sourceWindow.rows.length} 个。` : `数据库内共有 ${sourceWindow.total} 个来源；当前窗口按最新顺序展示 ${sourceWindow.rows.length} 个。`}{sourceWindow.hasMore ? ` 窗口上限为 ${sourceWindow.limit} 个。` : ""}</span></div><div className="admin-heading-actions"><Link className="admin-button admin-button--secondary" href={reviewOnly ? "/admin/knowledge" : "/admin/knowledge?view=review"}>{reviewOnly ? "查看全部来源" : "进入审核队列"}</Link><a className="admin-button" href="#new-source"><Plus aria-hidden="true" size={16} />新增来源</a></div></section>
    {query.notice === "queued" ? <p className="admin-inline-message" data-tone="success" role="status">来源已进入处理队列。</p> : null}
    {query.notice === "invalid" ? <p className="admin-inline-message" data-tone="error" role="status">来源未能进入处理队列，请检查输入后重试。</p> : null}
    <section className="admin-panel admin-source-table">
      <AdminTable<AdminKnowledgeSource>
        ariaLabel="知识来源"
        columns={[
          { key: "name", label: "来源", render: (row) => <span className="admin-table-primary"><strong>{row.name}</strong><small>{SOURCE_TYPE_LABELS[row.sourceType] ?? row.sourceType} · {formatDate(row.createdAt)}</small></span> },
          { key: "fetchStatus", label: "处理状态", render: (row) => <span className="admin-pill" data-status={row.fetchStatus}>{statusLabel(row.jobStatus ?? row.fetchStatus)}</span> },
          { key: "reviewStatus", label: "来源审核", render: (row) => <span className="admin-pill" data-status={row.reviewStatus}>{statusLabel(row.reviewStatus)}</span> },
          { key: "itemCount", label: "切片", render: (row) => <span className="admin-count"><strong>{row.itemCount}</strong><small>{row.pendingItemCount ? `${row.pendingItemCount} 待审` : "已处理"}</small></span> },
          { key: "action", label: "操作", render: (row) => <Link className="admin-text-link" href={`/admin/knowledge/${row.id}`}>查看详情</Link> },
        ]}
        rows={sources}
        rowKey={(row) => row.id}
        empty={reviewOnly ? "当前没有待审核来源" : "还没有知识来源"}
      />
    </section>
    <section className="admin-ingest-section" id="new-source">
      <div className="admin-section-heading"><span><Plus aria-hidden="true" size={18} strokeWidth={1.8} /></span><div><h2>新增知识来源</h2><p>三种入口进入同一条治理流水线，默认都不可直接用于生产检索。</p></div></div>
      <div className="admin-ingest-grid">
        <details className="admin-panel" open><summary><Upload aria-hidden="true" size={18} /><span><strong>上传文件</strong><small>TXT / PDF / DOCX，仅保存在本机</small></span></summary><KnowledgeUploadForm /></details>
        <details className="admin-panel"><summary><FileText aria-hidden="true" size={18} /><span><strong>手动文本</strong><small>粘贴方法、案例或平台规则</small></span></summary><form action={importKnowledgeAction} className="admin-form"><input name="kind" type="hidden" value="text" /><label>来源名称<input name="name" required maxLength={160} /></label><label>授权说明<input name="licenseNote" required maxLength={1000} /></label><div className="admin-form-grid"><label>适用平台<select name="platform" required defaultValue="all"><option value="all">全平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option><option value="bilibili">B 站</option><option value="wechat">公众号</option></select></label><label>内容类型<select name="contentType" required defaultValue="general"><option value="general">通用方法</option><option value="note">图文笔记</option><option value="video">视频</option><option value="article">长文章</option><option value="copy">短文案</option></select></label></div><label>标签（逗号分隔）<input name="tags" maxLength={400} placeholder="定位、选题、复盘" /></label><label>知识正文<textarea name="content" required rows={8} maxLength={200000} /></label><button className="admin-button" type="submit"><FileText aria-hidden="true" size={16} />提交文本来源</button></form></details>
      </div>
    </section>
  </div>;
}
