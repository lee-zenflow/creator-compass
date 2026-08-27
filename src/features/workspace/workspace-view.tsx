import Link from "next/link";

import { MetricSparkline } from "@/components/ui/metric-sparkline";
import { CompactEmptyState } from "@/components/ui/compact-empty-state";

import type { WorkspaceViewModel } from "./workspace-service";
import { CurrentStepRow } from "./current-step-row";

function rate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Trend({ points }: { points: Array<{ date: string; views: number | null }> }) {
  const confirmedPoints = points.filter(
    (point): point is { date: string; views: number } =>
      typeof point.views === "number",
  );
  if (confirmedPoints.length < 2) {
    return <div className="workspace-chart workspace-chart--empty">至少两次复盘后显示趋势</div>;
  }
  return (
    <div className="workspace-chart">
      <MetricSparkline
        label="播放趋势"
        points={confirmedPoints.map((point) => point.views)}
      />
      <small>{confirmedPoints[0].date.slice(5)} — {confirmedPoints.at(-1)?.date.slice(5)}</small>
    </div>
  );
}

export function WorkspaceView({ view }: { view: WorkspaceViewModel }) {
  if (view.kind === "newUser") {
    return (
      <div className="workspace-empty compact-page">
        <CurrentStepRow action={view.nextAction} />
        <div className="workspace-empty__copy">
          <strong>数据可以稍后补充</strong>
          <span>添加账号标签后，工作台会显示你确认过的真实表现数据。</span>
        </div>
        <Link className="compact-text-action" data-variant="text" href="/me/platforms">添加账号标签</Link>
      </div>
    );
  }

  return (
    <div className="workspace-dashboard compact-page">
      <Link className="workspace-account" href="/me/platforms">
        <span>
          <strong>{view.activeAccount.accountLabel ?? view.activeAccount.platform}</strong>
          <small>{view.activeAccount.platform} · {view.activeAccount.dataSource === "ocr" ? "本地OCR" : "手动录入"}</small>
        </span>
        <b>切换</b>
      </Link>
      <CurrentStepRow action={view.nextAction} />
      <nav aria-label="数据范围" className="compact-segmented">
        {([3, 7, 30] as const).map((range) => (
          <Link
            className="compact-segmented__item compact-segmented__link"
            data-active={range === view.range || undefined}
            href={`/workspace?range=${range}`}
            key={range}
          >{range}天</Link>
        ))}
      </nav>
      <section aria-label="周期指标" className="metric-strip workspace-metrics">
        <div data-testid="workspace-metric"><small>播放/阅读</small><strong>{view.metrics.views?.toLocaleString("zh-CN") ?? "—"}</strong></div>
        <div data-testid="workspace-metric"><small>互动率</small><strong>{rate(view.metrics.interactionRate)}</strong></div>
        <div data-testid="workspace-metric"><small>涨粉转化</small><strong>{rate(view.metrics.followerConversionRate)}</strong></div>
      </section>
      <Trend points={view.trend} />
      <section>
        <div className="compact-section-label">最新判断</div>
        {view.insight ? (
          <Link className="workspace-insight compact-card" href={`/reviews/${view.insight.reviewId}/report?report=${view.insight.reportId}&version=${view.insight.version}`}>
            <strong>{view.insight.problem ?? "已生成复盘结论"}</strong>
            <span>{view.insight.action ?? "查看完整复盘"}</span>
          </Link>
        ) : <CompactEmptyState icon="review" title="还没有复盘判断" detail="完成一次数据复盘后显示判断" />}
      </section>
      <section>
        <div className="compact-section-label">接下来</div>
        <div className="compact-stack">
          {view.upcomingTasks.length ? view.upcomingTasks.slice(0, 2).map((task) => (
            <Link className="workspace-task compact-card" data-testid="workspace-task" href={`/tasks/${task.id}`} key={task.id}>
              <strong>{task.title}</strong>
              <span>{task.plannedDate}</span>
            </Link>
          )) : <CompactEmptyState icon="tasks" title="未来 3 天没有待办" detail="确认方案后，任务会出现在这里" />}
        </div>
      </section>
      <section>
        <div className="compact-section-label">最近报告</div>
        {view.recentReports[0] ? (
          <Link className="workspace-report compact-card" href={`/reports?report=${view.recentReports[0].id}`}>
            <span>
              <strong>{view.recentReports[0].title}</strong>
              <small>{view.recentReports[0].summary ?? "查看版本记录"}</small>
            </span>
            <b>›</b>
          </Link>
        ) : <CompactEmptyState icon="reports" title="还没有报告" detail="定位、创作或复盘完成后会保留版本" />}
      </section>
    </div>
  );
}
