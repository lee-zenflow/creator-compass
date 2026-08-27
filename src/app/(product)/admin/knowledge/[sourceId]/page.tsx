import { ArrowLeft, BadgeCheck, CircleOff, ExternalLink, FileSearch, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  reviewKnowledgeChunkAction,
  reviewKnowledgeSourceAction,
  setKnowledgeChunkEnabledAction,
} from "@/features/admin/admin-actions";
import { getKnowledgeSourceDetail } from "@/features/admin/admin-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";

const STATUS_LABELS: Record<string, string> = {
  pending: "待审核",
  fetched: "已处理",
  failed: "失败",
  approved: "已通过",
  rejected: "已拒绝",
  queued: "排队中",
  fetching: "抓取中",
  parsing: "解析中",
  tagging: "标注中",
  pending_review: "待审核",
};

export default async function KnowledgeSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ sourceId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");

  const [{ sourceId }, query] = await Promise.all([params, searchParams]);
  const detail = await getKnowledgeSourceDetail(actor, sourceId);
  if (!detail) notFound();

  const sourceReady = detail.source.fetchStatus === "fetched";
  const sourceApproved = detail.source.reviewStatus === "approved" && detail.source.retrievalScope === "production";
  const notice = query.notice ? {
    "source-reviewed": { tone: "success", message: "来源审核决定已保存。" },
    "source-review-failed": { tone: "error", message: "来源审核未保存，请检查处理状态与拒绝原因。" },
    "chunk-reviewed": { tone: "success", message: "切片审核决定已保存。" },
    "chunk-review-failed": { tone: "error", message: "切片审核未保存，请检查来源状态与拒绝原因。" },
    "chunk-updated": { tone: "success", message: "切片启用状态已更新。" },
    "chunk-update-failed": { tone: "error", message: "切片启用状态更新失败。" },
  }[query.notice] : undefined;

  return (
    <div className="admin-page">
      <section className="admin-page-heading">
        <div>
          <Link className="admin-back-link" href="/admin/knowledge"><ArrowLeft aria-hidden="true" size={15} />知识来源</Link>
          <h2>{detail.source.name}</h2>
          <span>来源和切片需要分别人工审核；只有双重审核通过且明确授权后，才会发送给 DeepSeek。</span>
        </div>
        {detail.source.publicUrl ? <a className="admin-button admin-button--secondary" href={detail.source.publicUrl} rel="noreferrer" target="_blank">查看公开出处<ExternalLink aria-hidden="true" size={15} /></a> : null}
      </section>

      {notice ? <p className="admin-inline-message" data-tone={notice.tone} role="status">{notice.message}</p> : null}

      <section className="admin-source-summary">
        <article className="admin-panel">
          <div className="admin-section-heading"><span><FileSearch aria-hidden="true" size={18} /></span><div><h2>来源状态</h2><p>不展示私有存储键或原始内部错误。</p></div></div>
          <dl className="admin-definition-list">
            <div><dt>来源类型</dt><dd>{detail.source.sourceType}</dd></div>
            <div><dt>文档格式</dt><dd>{detail.source.originalMime ?? "由网页响应确定"}</dd></div>
            <div><dt>处理状态</dt><dd><span className="admin-pill" data-status={detail.source.fetchStatus}>{STATUS_LABELS[detail.job?.status ?? detail.source.fetchStatus] ?? detail.job?.status ?? detail.source.fetchStatus}</span></dd></div>
            <div><dt>来源审核</dt><dd><span className="admin-pill" data-status={detail.source.reviewStatus}>{STATUS_LABELS[detail.source.reviewStatus] ?? detail.source.reviewStatus}</span></dd></div>
            <div><dt>授权说明</dt><dd>{detail.source.licenseNote || "未提供"}</dd></div>
            <div><dt>检索范围</dt><dd>{detail.source.defaultPlatform ?? "全平台"} · {detail.source.defaultContentType ?? "通用"}</dd></div>
            <div><dt>本地向量</dt><dd><span className="admin-pill" data-status={detail.source.embeddingStatus}>{detail.source.embeddingStatus === "ready" ? "已就绪" : detail.source.embeddingStatus === "failed" ? "关键词降级" : "处理中"}</span></dd></div>
            <div><dt>发送给 AI</dt><dd>{detail.source.allowAiSend ? "已授权" : "未授权"}</dd></div>
            {detail.source.failureCode ? <div><dt>安全错误码</dt><dd>{detail.source.failureCode}</dd></div> : null}
          </dl>
        </article>

        <article className="admin-panel">
          <div className="admin-section-heading"><span><ShieldCheck aria-hidden="true" size={18} /></span><div><h2>来源审核</h2><p>{sourceReady ? "确认授权范围与整体质量后再通过。拒绝必须说明原因。" : "来源处理完成前不能通过审核。"}</p></div></div>
          <form action={reviewKnowledgeSourceAction} className="admin-review-actions">
            <input name="sourceId" type="hidden" value={sourceId} />
            <label className="admin-consent"><input name="allowAiSend" type="checkbox" value="true" defaultChecked={detail.source.allowAiSend} /><span>允许把命中的知识切片发送给 DeepSeek</span></label>
            <button className="admin-button" disabled={!sourceReady} name="reviewStatus" value="approved"><BadgeCheck aria-hidden="true" size={16} />{sourceApproved ? "保存来源与发送权限" : "通过来源"}</button>
          </form>
          <form action={reviewKnowledgeSourceAction} className="admin-review-note">
            <input name="sourceId" type="hidden" value={sourceId} />
            <input aria-label="来源拒绝原因" name="reviewNote" placeholder="拒绝原因（必填）" required />
            <button className="admin-button admin-button--danger" name="reviewStatus" value="rejected"><CircleOff aria-hidden="true" size={16} />拒绝来源</button>
          </form>
        </article>
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading"><span><FileSearch aria-hidden="true" size={18} /></span><div><h2>当前切片窗口质量</h2><p>以下指标仅按当前展示的 {detail.itemWindow.shown} 条切片计算；来源共有 {detail.itemWindow.total} 条，单次窗口最多 {detail.itemWindow.limit} 条，不读取或展示完整原文。</p></div></div>
        <dl className="admin-definition-list admin-quality-grid">
          <div><dt>字符 / 切片</dt><dd>{detail.quality.characters} / {detail.quality.chunks}</dd></div>
          <div><dt>平均长度</dt><dd>{detail.quality.averageChunkLength}</dd></div>
          <div><dt>当前窗口审核进度</dt><dd>{detail.reviewProgress.reviewed} / {detail.reviewProgress.total}</dd></div>
          <div><dt>过短 / 过长</dt><dd>{detail.quality.short} / {detail.quality.long}</dd></div>
          <div><dt>重复切片</dt><dd>{detail.quality.duplicate}</dd></div>
          <div><dt>缺少元数据</dt><dd>{detail.quality.missingMetadata}</dd></div>
        </dl>
      </section>

      <section className="admin-chunk-section">
        <div className="admin-section-heading"><span><ShieldCheck aria-hidden="true" size={18} /></span><div><h2>来源审核记录</h2><p>按最新顺序展示最多 100 条追加式记录；审核人、原因与前后状态不会被后续审核覆盖。</p></div></div>
        {detail.reviewHistory.length ? <div className="admin-chunk-list">{detail.reviewHistory.map((event) => (
          <article className="admin-panel admin-chunk" key={event.id}>
            <header><div><h3>{event.reviewerName}</h3><small>{event.createdAt.toLocaleString("zh-CN")} · {STATUS_LABELS[event.previousReviewStatus]} → {STATUS_LABELS[event.newReviewStatus]}</small></div><span className="admin-pill" data-status={event.newReviewStatus}>{STATUS_LABELS[event.newReviewStatus]}</span></header>
            <p className="admin-chunk__excerpt">{event.reason || "未填写说明"}</p>
          </article>
        ))}</div> : <div className="admin-empty"><strong>暂无来源审核记录</strong><small>完成来源审核后，这里会显示追加式历史。</small></div>}
      </section>

      <section className="admin-chunk-section">
        <div className="admin-section-heading"><span><ShieldCheck aria-hidden="true" size={18} /></span><div><h2>切片审核记录</h2><p>按最新顺序展示最多 100 条追加式记录，与切片当前状态分开保存。</p></div></div>
        {detail.itemReviewHistory.length ? <div className="admin-chunk-list">{detail.itemReviewHistory.map((event) => (
          <article className="admin-panel admin-chunk" key={event.id}>
            <header><span className="admin-chunk__index">#{String(event.chunkIndex + 1).padStart(2, "0")}</span><div><h3>{event.itemTitle}</h3><small>{event.reviewerName} · {event.createdAt.toLocaleString("zh-CN")} · {STATUS_LABELS[event.previousReviewStatus]} → {STATUS_LABELS[event.newReviewStatus]}</small></div><span className="admin-pill" data-status={event.newReviewStatus}>{STATUS_LABELS[event.newReviewStatus]}</span></header>
            <p className="admin-chunk__excerpt">{event.reason || "未填写说明"}</p>
          </article>
        ))}</div> : <div className="admin-empty"><strong>暂无切片审核记录</strong><small>完成切片审核后，这里会显示追加式历史。</small></div>}
      </section>

      <section className="admin-chunk-section">
        <div className="admin-section-heading"><span><BadgeCheck aria-hidden="true" size={18} /></span><div><h2>知识切片审核</h2><p>当前窗口展示 {detail.itemWindow.shown} / {detail.itemWindow.total} 条，最多 {detail.itemWindow.limit} 条。这里只显示受限长度的切片预览，不展示对象存储路径。</p></div></div>
        {detail.items.length ? <div className="admin-chunk-list">{detail.items.map((item) => (
          <article className="admin-panel admin-chunk" key={item.id}>
            <header><span className="admin-chunk__index">#{String(item.chunkIndex + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><small>{item.platform ?? "全平台"} · {item.contentType ?? "未分类"} · {item.tags.join(" / ") || "无标签"}</small></div><span className="admin-pill" data-status={item.enabled ? item.reviewStatus : "disabled"}>{item.enabled ? STATUS_LABELS[item.reviewStatus] ?? item.reviewStatus : "已停用"}</span></header>
            <p className="admin-chunk__excerpt">{item.excerpt}</p>
            <footer>
              <form action={reviewKnowledgeChunkAction} className="admin-review-note"><input name="sourceId" type="hidden" value={sourceId} /><input name="itemId" type="hidden" value={item.id} /><input aria-label={`切片 ${item.chunkIndex + 1} 通过说明`} name="reviewNote" placeholder="通过说明（可选）" /><button disabled={!sourceApproved} name="reviewStatus" value="approved">通过</button></form>
              <form action={reviewKnowledgeChunkAction} className="admin-review-note"><input name="sourceId" type="hidden" value={sourceId} /><input name="itemId" type="hidden" value={item.id} /><input aria-label={`切片 ${item.chunkIndex + 1} 拒绝原因`} name="reviewNote" placeholder="拒绝原因（必填）" required /><button name="reviewStatus" value="rejected">拒绝</button></form>
              <form action={setKnowledgeChunkEnabledAction}><input name="sourceId" type="hidden" value={sourceId} /><input name="itemId" type="hidden" value={item.id} /><button className="admin-text-button" name="enabled" value={item.enabled ? "false" : "true"}>{item.enabled ? "停用切片" : "重新启用"}</button></form>
            </footer>
          </article>
        ))}</div> : <div className="admin-empty"><strong>尚未生成知识切片</strong><small>来源处理完成后，真实切片会出现在这里。</small></div>}
      </section>
    </div>
  );
}
