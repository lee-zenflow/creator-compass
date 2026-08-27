"use client";

import { Search } from "lucide-react";
import { useActionState } from "react";

import { testKnowledgeRetrievalAction } from "@/features/admin/admin-actions";
import type { RetrievalRejection, RetrievalSignal } from "@/server/search/retrieval-explanation";

type RetrievalState = Awaited<ReturnType<typeof testKnowledgeRetrievalAction>> | null;

const rejectionLabels: Record<RetrievalRejection, string> = {
  SOURCE_NOT_APPROVED: "来源未通过审核",
  SOURCE_NOT_PRODUCTION: "来源不在生产范围",
  SOURCE_DEMO: "演示来源",
  SOURCE_AI_SEND_NOT_ALLOWED: "来源未授权发送给 DeepSeek",
  ITEM_NOT_APPROVED: "条目未通过审核",
  ITEM_NOT_PRODUCTION: "条目不在生产范围",
  ITEM_DEMO: "演示条目",
  ITEM_DISABLED: "条目已停用",
  OUTSIDE_VALIDITY: "规则不在有效期",
  PLATFORM_MISMATCH: "平台不匹配",
  CONTENT_TYPE_MISMATCH: "内容类型不匹配",
  NO_DETERMINISTIC_MATCH: "没有确定性匹配",
};

function signalLabel(signal: RetrievalSignal) {
  const prefix = {
    base: "基础相关性",
    knowledge_bonus: "知识切片",
    database_rank: "数据库文本相关性",
    exact_tag: "标签完全匹配",
    substring: "正文包含关键词",
    token: "分词匹配",
  }[signal.kind];
  return `${prefix}${signal.value ? ` ${signal.value}` : ""} +${signal.contribution}`;
}

export function RetrievalLab({ initialResult = null }: { initialResult?: RetrievalState }) {
  const [state, action, pending] = useActionState<RetrievalState, FormData>(
    async (_previous, form) => testKnowledgeRetrievalAction(form),
    initialResult,
  );

  return (
    <div className="admin-lab-grid">
      <form action={action} className="admin-panel admin-form">
        <div className="admin-section-heading"><span><Search aria-hidden="true" size={18} strokeWidth={1.8} /></span><div><h2>构造审核检视条件</h2><p>复用生产检索的纯门槛与评分规则，同时检查待审、停用等受限候选；这不是一次生产检索调用。</p></div></div>
        <label>平台<input name="platform" required placeholder="xiaohongshu" /></label>
        <label>内容类型<input name="contentType" required placeholder="note" /></label>
        <label>标签<input name="tags" placeholder="个人IP, 定位" /></label>
        <label>关键词<input name="keywords" placeholder="个人IP定位" /></label>
        <button className="admin-button" disabled={pending} type="submit"><Search aria-hidden="true" size={16} />{pending ? "检视中" : "运行审核检视"}</button>
      </form>
      <section className="admin-panel admin-retrieval-results" aria-live="polite">
        <div className="admin-section-heading"><div><h2>审核检视结果</h2><p>候选检查有固定上限；通过门槛的候选按共享评分规则排序，不代表生产调用的完整候选范围。</p></div></div>
        {!state ? <div className="admin-empty"><strong>尚未运行检索</strong><small>填写左侧条件，验证知识能否被真实业务链路命中。</small></div> : null}
        {state && !state.ok ? <p className="admin-inline-message" data-tone="error">{state.error}</p> : null}
        {state?.ok && state.hits.length === 0 ? <div className="admin-empty"><strong>没有符合生产门槛的结果</strong><small>这不是错误；请检查审核状态、平台、内容类型和关键词。</small></div> : null}
        {state?.ok ? <p className="admin-retrieval-summary">本次窗口上限 {state.inspectionLimit} 条；检查 {state.candidateCount} 条候选，{state.acceptedCandidateCount} 条通过，{state.excludedCandidateCount} 条被排除。过滤原因可重叠，按规则触发次数统计。</p> : null}
        {state?.ok && Object.keys(state.reasonCounts).length > 0 ? <div className="admin-filter-summary">
          {Object.entries(state.reasonCounts).map(([reason, count]) => count ? <span key={reason}>{rejectionLabels[reason as RetrievalRejection]}：{count} 次</span> : null)}
        </div> : null}
        {state?.ok ? <div className="admin-hit-list">{state.hits.map((hit, index) => <article className="admin-hit" data-testid="retrieval-hit" key={`${hit.kind}:${hit.sourceName}:${hit.title}:${index}`}>
          <span className="admin-hit__rank">{String(index + 1).padStart(2, "0")}</span>
          <div><small>{hit.kind === "rule" ? "平台规则" : "知识切片"} · {hit.sourceName} · V{hit.version}</small><h3>{hit.title}</h3><p>{hit.excerpt}</p><span>匹配分 {hit.score.toFixed(1)}</span><details><summary>为什么命中</summary>{hit.signals.map((signal, signalIndex) => <div key={`${signal.kind}:${signal.value ?? signalIndex}`}>{signalLabel(signal)}</div>)}</details></div>
        </article>)}</div> : null}
      </section>
    </div>
  );
}
