import type { CitationView } from "@/features/citations/citation-service";

export function CitationList({
  citations,
  emptyDetail = "仅基于本次输入，暂无匹配案例依据",
}: {
  citations: CitationView[];
  emptyDetail?: string;
}) {
  if (citations.length === 0) return <p className="citation-list__empty">{emptyDetail}</p>;
  return <ul className="citation-list">{citations.map((citation) => <li key={`${citation.itemId}:${citation.sourceId}`}>
    <div>
      <strong>{citation.publicUrl ? <a href={citation.publicUrl} rel="noreferrer" target="_blank">{citation.title}</a> : citation.title}</strong>
      <small>{citation.sourceName} · {citation.sourceType === "public_web" ? "公开网页" : "已审核资料"}</small>
      <p>{citation.summary}</p>
    </div>
  </li>)}</ul>;
}
