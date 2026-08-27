import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

import { AppShell } from "@/components/app-shell/app-shell";
import { CitationList } from "@/components/ui/citation-list";
import { ModuleIcon } from "@/components/ui/module-icon";
import { resolveCurrentActor, type CurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { getReportDetail, getReportsLatestMeta } from "@/features/reports/report-read-service";
import { ReportList, REPORT_STATUS_LABELS } from "@/features/reports/report-list";
import { listReports } from "@/features/reports/report-service";

const noticeCopy = {
  archived: "报告已归档，历史版本和引用依据均已保留。",
  restored: "报告已恢复到当前列表。",
  failed: "操作未完成，请稍后重试。",
} as const;
const reportTypes = new Set(["positioning", "creation", "review"] as const);

function formatDate(value: Date) {
  return value.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reportListHref(
  archivedView: boolean,
  activeType: "all" | "positioning" | "creation" | "review",
) {
  const params = new URLSearchParams();
  if (archivedView) params.set("view", "archived");
  if (activeType !== "all") params.set("type", activeType);
  const query = params.toString();
  return query ? `/reports?${query}` : "/reports";
}

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ report?: string; view?: string; notice?: string; type?: string }>;
}) {
  let actor: CurrentActor;
  try {
    actor = await resolveCurrentActor(await headers(), await cookies());
  } catch {
    redirect(HOME_REDIRECT_TARGET);
  }
  const query = await searchParams;
  const selectedId = query.report;
  const archivedView = query.view === "archived";
  const activeType = query.type && reportTypes.has(query.type as "positioning" | "creation" | "review")
    ? query.type as "positioning" | "creation" | "review"
    : "all";
  const notice = query.notice && query.notice in noticeCopy
    ? noticeCopy[query.notice as keyof typeof noticeCopy]
    : null;
  if (selectedId) {
    let detail;
    try {
      detail = await getReportDetail(actor, selectedId);
    } catch {
      redirect("/reports");
    }
    return (
      <AppShell title="报告详情" backHref={reportListHref(archivedView, activeType)} bottomNav={false}>
        <article className="flow-content compact-page report-detail">
          <header className="compact-card">
            <ModuleIcon name={detail.root.type} label={`${detail.root.type === "positioning" ? "定位" : detail.root.type === "creation" ? "创作" : "复盘"}报告`} />
            <small>{detail.root.type === "positioning" ? "定位" : detail.root.type === "creation" ? "创作" : "复盘"}</small>
            <h2>{detail.root.title}</h2>
            {detail.root.summary ? <p>{detail.root.summary}</p> : null}
            <p>最近更新于 {formatDate(detail.root.updatedAt)}</p>
          </header>
          <section>
            <h3>版本记录</h3>
            <div className="compact-stack">
              {detail.versions.map((version) => (
                <div className="report-version compact-card" key={version.id}>
                  <div className="report-version__heading">
                    <strong>V{version.version}</strong>
                    <span>{REPORT_STATUS_LABELS[version.status]}</span>
                  </div>
                  <dl className="report-version__facts">
                    <div><dt>生成方式</dt><dd>{version.generationMode === "ai" ? "AI 生成" : "人工调整"}</dd></div>
                    <div><dt>生成时间</dt><dd>{formatDate(version.createdAt)}</dd></div>
                    {version.model ? <div><dt>模型</dt><dd>{version.model}</dd></div> : null}
                    {version.parentVersion ? <div><dt>基于版本</dt><dd>V{version.parentVersion}</dd></div> : null}
                  </dl>
                  <div className="report-version__links">
                    <Link href={version.domainHref}>打开原报告</Link>
                    {version.recoveryHref ? <Link href={version.recoveryHref}>返回原流程重试</Link> : null}
                  </div>
                  <div className="report-version__citations">
                    <h4>
                      引用依据
                      {version.generationMode === "ai" ? (
                        <span>引用 {version.citationMode === "legacy" ? version.legacySources.length : version.citations.length} 条</span>
                      ) : null}
                    </h4>
                    {version.citationMode === "legacy" ? (
                      <div className="legacy-citation-view">
                        <p>历史版本仅保存了来源，无法恢复到具体知识条目；该版本只读。</p>
                        {version.legacySources.length > 0 ? <ul>{version.legacySources.map((source) => (
                          <li key={source.id}>{source.publicUrl ? (
                            <a href={source.publicUrl} rel="noreferrer" target="_blank">{source.name}</a>
                          ) : source.name}</li>
                        ))}</ul> : null}
                      </div>
                    ) : (
                      <CitationList citations={version.citations} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </article>
      </AppShell>
    );
  }
  const reportRecords = await listReports(
    actor,
    activeType === "all" ? undefined : activeType,
    undefined,
    archivedView ? "archived" : "active",
  );
  const latestMeta = await getReportsLatestMeta(actor, reportRecords);
  const latestByReport = new Map(latestMeta.map((item) => [item.reportId, item]));
  const reportItems = reportRecords.map((report) => {
    const latest = latestByReport.get(report.id);
    if (!latest) throw new Error("NOT_FOUND");
    return {
      id: report.id,
      href: `/reports?report=${report.id}${archivedView ? "&view=archived" : ""}${activeType === "all" ? "" : `&type=${activeType}`}`,
      type: report.type,
      title: report.title,
      summary: report.summary,
      status: report.status,
      updatedAt: report.updatedAt.toLocaleDateString("zh-CN"),
      latestVersion: latest.version,
      generationMode: latest.generationMode,
      domainHref: latest.domainHref,
    };
  });
  return (
    <AppShell title="报告记录" backHref="/workspace" bottomNav={false}>
      <div className="flow-content compact-page">
        {notice ? <p className="compact-message" role="status">{notice}</p> : null}
        <nav aria-label="报告状态" className="compact-segmented report-view-switch">
          <Link aria-current={!archivedView ? "page" : undefined} className="compact-segmented__link" href={activeType === "all" ? "/reports" : `/reports?type=${activeType}`}>当前报告</Link>
          <Link aria-current={archivedView ? "page" : undefined} className="compact-segmented__link" href={`/reports?view=archived${activeType === "all" ? "" : `&type=${activeType}`}`}>已归档</Link>
        </nav>
        <ReportList activeType={activeType} archivedView={archivedView} reports={reportItems} />
      </div>
    </AppShell>
  );
}
