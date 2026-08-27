import { z } from "zod";

export const reviewPlatformSchema = z.enum(["douyin", "xiaohongshu", "bilibili", "wechat", "other"]);
const metric = z.number().int().min(0).max(1_000_000_000).optional();

export const ocrMetricDraftSchema = z.object({
  platform: reviewPlatformSchema,
  title: z.string().trim().max(240).optional(),
  publishedAt: z.string().trim().max(40).optional(),
  views: metric,
  likes: metric,
  comments: metric,
  favorites: metric,
  shares: metric,
  followersGained: metric,
}).strict();

export type OcrMetricDraft = z.infer<typeof ocrMetricDraftSchema>;
export type MissingReviewField = "platform" | "title" | "publishedAt" | "views" | "interactionMetric";
