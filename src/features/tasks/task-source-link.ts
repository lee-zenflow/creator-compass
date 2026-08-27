import type { ReportType } from "./task-service";

export type TaskSourceLinkInput = {
  type: ReportType;
  entityId: string | null;
  reportId: string;
  version: number;
};

export function taskSourceHref(source: TaskSourceLinkInput) {
  if (!source.entityId) return `/reports?report=${source.reportId}`;
  const query = `report=${source.reportId}&version=${source.version}`;
  if (source.type === "positioning") {
    return `/positioning/${source.entityId}/report?${query}`;
  }
  if (source.type === "creation") {
    return `/creation/${source.entityId}/plan?${query}`;
  }
  return `/reviews/${source.entityId}/report?${query}`;
}
