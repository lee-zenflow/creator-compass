import Link from "next/link";

import { StatusRow } from "@/components/ui/status-row";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";

import type { PositioningCandidate } from "./positioning-schemas";
import type {
  InterviewMessageRecord,
  PositioningRunRecord,
  PositioningSessionRecord,
} from "./positioning-read-service";
import { AiRunWatcher } from "./ai-run-watcher";

type PositioningTask = PositioningCandidate["initialTasks"][number];

const profileDimensionLabels = [
  ["interestsExperience", "兴趣与经历"],
  ["skills", "能力与技能"],
  ["resources", "可用资源"],
  ["availableTime", "可投入时间"],
  ["creationGoal", "创作目标"],
  ["platformPreference", "平台偏好"],
  ["sustainableSources", "持续内容来源"],
  ["constraints", "现实限制"],
] as const;

const statusLabels = {
  draft: "访谈中",
  processing: "生成中",
  ready: "已生成",
  failed: "生成失败",
  archived: "已归档",
} as const;

function shortDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date).replace("/", "月") + "日";
}

export function PositioningRecordList({ records }: { records: PositioningSessionRecord[] }) {
  if (records.length === 0) return <CompactEmptyState icon="positioning" title="还没有定位记录" detail="新建一次访谈，逐步梳理真实创作条件" />;
  return (
    <div className="positioning-records">
      {records.map((record) => (
        <Link className="positioning-record compact-card" href={`/positioning/${record.id}`} key={record.id}>
          <span className="positioning-record__mark" aria-hidden="true" />
          <span className="positioning-record__copy">
            <strong>新建定位 · {shortDate(record.createdAt)}</strong>
            <small>画像完整度 {record.completeness}% · {record.completeness >= 80 ? "可生成报告" : "可继续访谈"}</small>
          </span>
          <span className="positioning-record__status">{statusLabels[record.status]}</span>
        </Link>
      ))}
    </div>
  );
}

export function InterviewPanel({
  sessionId,
  currentStep = 0,
  completeness,
  messages,
  latestRun,
  profileDimensions,
}: {
  sessionId: string;
  currentStep?: number;
  completeness: number;
  messages: InterviewMessageRecord[];
  latestRun: Pick<PositioningRunRecord, "id" | "taskType" | "status" | "errorCode" | "safeErrorDetail"> | null;
  profileDimensions?: Record<string, unknown>;
}) {
  return (
    <div className="positioning-interview">
      <section className="profile-progress" aria-label="画像完整度">
        <div><strong>画像完整度</strong><span>{completeness}%</span></div>
        <div className="profile-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness}>
          <span style={{ width: `${Math.max(0, Math.min(100, completeness))}%` }} />
        </div>
      </section>
      <details className="profile-dimensions compact-card">
        <summary>查看 8 项画像完整度</summary>
        <div>
          {profileDimensionLabels.map(([key, label]) => {
            const value = profileDimensions?.[key];
            const score = value && typeof value === "object"
              ? Number((value as Record<string, unknown>).score ?? 0)
              : 0;
            return <span key={key}><b>{label}</b><small>{score === 100 ? "完整" : score === 50 ? "部分" : "待补充"}</small></span>;
          })}
        </div>
      </details>
      {currentStep >= 10 ? (
        <p className="interview-round-complete">
          {completeness >= 80
            ? "10轮核心访谈已完成，可继续补充画像信息或生成报告"
            : "10轮核心访谈已完成，可继续补充画像信息"}
        </p>
      ) : null}
      <section className="interview-messages" aria-label="访谈内容">
        {messages.length === 0 ? <p className="interview-empty">还没有访谈内容，填写第一条信息开始。</p> : null}
        {messages.map((item) => (
          <p className="interview-bubble" data-sender={item.sender} key={item.id}>{item.content}</p>
        ))}
      </section>
      {latestRun?.status === "processing" ? (
        <div className="position-run-state" data-phase="processing">
          <StatusRow state="processing" title="请求已保存，AI 正在处理" />
        </div>
      ) : null}
      {latestRun?.status === "ready" ? (
        <StatusRow state="success" title="结果已保存" />
      ) : null}
      {latestRun?.status === "processing" ? <AiRunWatcher runId={latestRun.id} /> : null}
      {latestRun?.status === "processing" ? <span className="sr-only">定位会话 {sessionId} 正在处理</span> : null}
    </div>
  );
}

export function CandidateCards({
  sessionId,
  reportId,
  reportVersion,
  candidates,
}: {
  sessionId: string;
  reportId: string;
  reportVersion: number;
  candidates: PositioningCandidate[];
}) {
  return (
    <div className="candidate-cards">
      {candidates.map((candidate, index) => (
        <article
          className="candidate-card compact-card instrument-panel"
          data-candidate-index={index + 1}
          key={candidate.id}
        >
          <span className="candidate-card__coordinate" aria-hidden="true">
            POSITION {String(index + 1).padStart(2, "0")}
          </span>
          <h2>方案 {String.fromCharCode(65 + index)}：{candidate.name}</h2>
          <p><span>目标人设</span>{candidate.audience}</p>
          <p><span>内容方向</span>{candidate.direction}</p>
          <div className="candidate-card__summary-block">
            <span>匹配说明</span>
            <p className="candidate-card__summary line-clamp-2" data-testid="candidate-summary">{candidate.matchExplanation}</p>
          </div>
          <Link href={`/positioning/${sessionId}/report/${candidate.id}?report=${reportId}&version=${reportVersion}`}>查看详情 ›</Link>
        </article>
      ))}
    </div>
  );
}

export function shouldDefaultSelectTask(
  task: Pick<PositioningTask, "plannedDate" | "priority" | "steps">,
  now = new Date(),
) {
  const planned = new Date(`${task.plannedDate}T00:00:00Z`).getTime();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const difference = Math.floor((planned - start) / 86_400_000);
  return difference >= 0 && difference <= 3 && task.priority === 1 && task.steps.length > 0;
}

export function PositioningTaskCards({ tasks, now = new Date() }: { tasks: PositioningTask[]; now?: Date }) {
  return (
    <div className="positioning-task-cards">
      {tasks.map((task) => (
        <label className="positioning-task-card compact-card" key={task.id}>
          <input type="checkbox" name="taskId" value={task.id} defaultChecked={shouldDefaultSelectTask(task, now)} />
          <span className="positioning-task-card__copy">
            <strong>{task.title}</strong>
            <small className="task-card__steps line-clamp-2">步骤：{task.steps.join(" → ")}</small>
            <span className="positioning-task-card__meta"><small>{task.plannedDate} · {task.estimatedMinutes} 分钟</small><small>完成标准：{task.completionCriteria}</small></span>
          </span>
          <span className="positioning-task-card__handle" aria-hidden="true">≡</span>
        </label>
      ))}
    </div>
  );
}
