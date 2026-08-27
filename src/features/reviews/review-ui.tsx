import type { ReviewReportOutput } from "./review-report-schemas";
import type { CitationView } from "@/features/citations/citation-service";
import { CitationList } from "@/components/ui/citation-list";

const metricLabels: Record<string, string> = {
  views: "播放/阅读", likes: "点赞", comments: "评论", favorites: "收藏",
  shares: "分享", followersGained: "涨粉",
};
const calculatedLabels: Record<string, string> = {
  interactionCount: "互动总数", interactionRate: "互动率",
  followerConversionRate: "涨粉转化率", viewGrowthRate: "播放增长率",
  interactionRateChange: "互动率变化",
};

function calculatedValue(key: string, value: number | null) {
  if (value === null) return "无法计算";
  return key === "interactionCount" ? value.toLocaleString("zh-CN") : `${(value * 100).toFixed(2)}%`;
}

function List({ values, empty = "暂无" }: { values: string[]; empty?: string }) {
  return values.length ? <ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul> : <p className="review-empty">{empty}</p>;
}

type ReviewSectionId = "confirmed-metrics" | "calculated-metrics" | "conclusion" | "evidence" | "actions";

function Section({ id, title, dataPulse = false, children }: {
  id: ReviewSectionId;
  title: string;
  dataPulse?: boolean;
  children: React.ReactNode;
}) {
  return <section className={`review-report__section${dataPulse ? " data-pulse-panel" : ""}`} data-section={id}><h3>{title}</h3>{children}</section>;
}

export function ReviewReportView({
  confirmedMetrics,
  calculatedMetrics,
  report,
  citations,
  legacySources = [],
}: {
  confirmedMetrics: Record<string, number | string | null>;
  calculatedMetrics: Record<string, number | null>;
  report: ReviewReportOutput;
  citations: CitationView[];
  legacySources?: Array<{ id: string; name: string; publicUrl: string | null }>;
}) {
  return <article className="review-report">
    <Section dataPulse id="confirmed-metrics" title="已确认的原始数据"><dl className="review-metrics">{Object.entries(confirmedMetrics).map(([key, value]) => <div key={key}><dt>{metricLabels[key] ?? key}</dt><dd>{value ?? "未提供"}</dd></div>)}</dl></Section>
    <Section dataPulse id="calculated-metrics" title="程序计算"><dl className="review-metrics">{Object.entries(calculatedMetrics).map(([key, value]) => <div key={key}><dt>{calculatedLabels[key] ?? key}</dt><dd>{calculatedValue(key, value)}</dd></div>)}</dl></Section>
    <Section id="conclusion" title="AI复盘结论"><div className="review-conclusion"><strong>值得保留</strong><List values={report.retained} /><strong>存在问题</strong><List values={report.problems} /><strong>可能原因</strong><List values={report.causes} /></div></Section>
    <Section id="evidence" title="参考依据">{legacySources.length ? <><p className="review-empty">历史报告仅保留来源级依据，无法追溯到具体资料片段；请重新生成后再编辑。</p><ul>{legacySources.map((source) => <li key={source.id}>{source.publicUrl ? <a href={source.publicUrl} rel="noreferrer" target="_blank">{source.name}</a> : source.name}</li>)}</ul></> : <CitationList citations={citations} emptyDetail="仅基于确认数据与个人资料，暂无匹配案例依据" />}</Section>
    <Section id="actions" title="下一轮行动"><div className="compact-stack">{report.actions.map((action) => <div className="review-action compact-card" key={action.id}><strong>{action.title}</strong><small>{action.plannedDate} · {action.estimatedMinutes} 分钟</small><p>{action.reason}</p></div>)}</div></Section>
  </article>;
}

export function ReviewTaskRows({ tasks }: { tasks: ReviewReportOutput["actions"] }) {
  return <div className="compact-stack">{tasks.map((task) => <label className="creation-task-row compact-card" key={task.id}>
    <input defaultChecked name="selectedTaskIds" type="checkbox" value={task.id} />
    <span><strong>{task.title}</strong><small>{task.plannedDate} · {task.estimatedMinutes} 分钟</small><small className="task-card__steps line-clamp-2">{task.steps.join(" → ")}</small></span>
  </label>)}</div>;
}
