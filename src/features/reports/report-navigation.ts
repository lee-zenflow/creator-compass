export type ReportTypeFilter = "all" | "positioning" | "creation" | "review";
export type ReportView = "active" | "archived";

export function reportNoticeHref(
  view: ReportView,
  type: ReportTypeFilter,
  notice: "archived" | "restored" | "failed",
) {
  const params = new URLSearchParams();
  if (view === "archived") params.set("view", "archived");
  if (type !== "all") params.set("type", type);
  params.set("notice", notice);
  return `/reports?${params.toString()}`;
}
