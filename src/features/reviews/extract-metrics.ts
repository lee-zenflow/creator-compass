import { ocrMetricDraftSchema, type MissingReviewField, type OcrMetricDraft } from "./review-schemas";

function numberValue(raw: string | undefined) {
  if (!raw) return undefined;
  const normalized = raw.replace(/,/g, "").trim();
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * (raw.includes("万") ? 10_000 : 1));
}

function metric(text: string, labels: string[]) {
  const label = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return numberValue(text.match(new RegExp(`(?:${label})\\s*[:：]?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?\\s*万?)`, "i"))?.[1]);
}

export function extractMetricsFromText(text: string, platform: OcrMetricDraft["platform"]): OcrMetricDraft {
  const compact = text.normalize("NFKC").replace(/\s+/g, " ");
  const publishedAt = compact.match(/(?:发布时间|发布于|时间)\s*[:：]?\s*([0-9]{1,4}[-/.][0-9]{1,2}(?:[-/.][0-9]{1,2})?(?:\s+[0-9]{1,2}:[0-9]{2})?)/)?.[1];
  return ocrMetricDraftSchema.parse({
    platform,
    publishedAt,
    views: metric(compact, ["播放量", "阅读量", "浏览量", "观看量"]),
    likes: metric(compact, ["点赞", "赞"]),
    comments: metric(compact, ["评论"]),
    favorites: metric(compact, ["收藏"]),
    shares: metric(compact, ["分享", "转发"]),
    followersGained: metric(compact, ["涨粉", "新增粉丝"]),
  });
}

export function validateMinimumReviewFields(draft: Partial<OcrMetricDraft>): MissingReviewField[] {
  const missing: MissingReviewField[] = [];
  if (!draft.platform) missing.push("platform");
  if (!draft.title?.trim()) missing.push("title");
  if (!draft.publishedAt?.trim()) missing.push("publishedAt");
  if (draft.views === undefined) missing.push("views");
  if ([draft.likes, draft.comments, draft.favorites, draft.shares, draft.followersGained].every((value) => value === undefined)) missing.push("interactionMetric");
  return missing;
}
