import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink } from "lucide-react";

import { REPORT_ICONS } from "@/features/navigation/module-icons";
import { archiveReportAction, restoreReportAction } from "./report-actions";
import { ReportSubmitButton } from "./report-submit-button";

type ReportListItem = {
  id: string;
  href: string;
  type: "positioning" | "creation" | "review";
  title: string;
  summary: string | null;
  status: "draft" | "processing" | "ready" | "failed" | "archived";
  updatedAt?: string;
  domainHref?: string;
  latestVersion?: number;
  generationMode?: "ai" | "manual";
};

const filters = [
  { id: "all", label: "全部" },
  { id: "positioning", label: "定位" },
  { id: "creation", label: "创作" },
  { id: "review", label: "复盘" },
] as const;

const typeLabels = { positioning: "定位报告", creation: "创作方案", review: "复盘报告" } as const;
type ReportTypeFilter = (typeof filters)[number]["id"];
export const REPORT_STATUS_LABELS = {
  draft: "草稿",
  processing: "生成中",
  ready: "已完成",
  failed: "生成失败",
  archived: "已归档",
} as const;

export function ReportList({
  reports,
  archivedView = false,
  activeType = "all",
}: {
  reports: ReportListItem[];
  archivedView?: boolean;
  activeType?: ReportTypeFilter;
}) {
  const filterHref = (type: ReportTypeFilter) => {
    const params = new URLSearchParams();
    if (archivedView) params.set("view", "archived");
    if (type !== "all") params.set("type", type);
    const query = params.toString();
    return query ? `/reports?${query}` : "/reports";
  };
  return (
    <section aria-label="报告列表">
      <div className="compact-segmented">
        {filters.map((filter) => (
          <Link
            aria-current={activeType === filter.id ? "page" : undefined}
            className="compact-segmented__item compact-segmented__link"
            data-active={activeType === filter.id || undefined}
            href={filterHref(filter.id)}
            key={filter.id}
          >
            {filter.label}
          </Link>
        ))}
      </div>
      <div className="compact-stack compact-stack--spaced">
        {reports.length === 0 ? <div className="compact-empty">暂无此类报告</div> : reports.map((report) => {
          const ReportIcon = REPORT_ICONS[report.type];
          const LifecycleIcon = archivedView ? ArchiveRestore : Archive;
          return (
            <article className="report-card compact-card" key={report.id}>
              <Link className="report-card__main" href={report.href}>
                <div className="report-card__meta">
                <span aria-label={`类型：${typeLabels[report.type]}`} className="record-source">
                  <ReportIcon aria-hidden="true" size={16} strokeWidth={1.8} />
                  {typeLabels[report.type]}
                </span>
                <span>{REPORT_STATUS_LABELS[report.status]}{report.updatedAt ? ` · ${report.updatedAt}` : ""}</span>
                </div>
                <strong className="line-clamp-1">{report.title}</strong>
                <p className="report-card__version line-clamp-1">
                  {report.latestVersion ? `V${report.latestVersion} · ${report.generationMode === "manual" ? "人工调整" : "AI 生成"}` : report.summary}
                </p>
              </Link>
              <div className="report-card__actions">
                {report.domainHref ? (
                  <Link aria-label="打开原报告" className="compact-icon-action" href={report.domainHref}>
                    <ExternalLink aria-hidden="true" size={16} strokeWidth={1.8} />
                  </Link>
                ) : null}
                <form action={archivedView ? restoreReportAction : archiveReportAction}>
                  <input name="reportId" type="hidden" value={report.id} />
                  <input name="type" type="hidden" value={activeType} />
                  <input name="view" type="hidden" value={archivedView ? "archived" : "active"} />
                  <ReportSubmitButton label={`${archivedView ? "恢复" : "归档"}${report.title}`}>
                    <LifecycleIcon aria-hidden="true" size={16} strokeWidth={1.8} />
                  </ReportSubmitButton>
                </form>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
