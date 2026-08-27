import { describe, expect, test } from "vitest";

import { extractMetricsFromText, validateMinimumReviewFields } from "./extract-metrics";

describe("OCR metric extraction", () => {
  test("extracts Chinese metric labels and numbers", () => {
    const draft = extractMetricsFromText("发布时间 07-14 20:30 播放量 3,628 点赞 186 评论 24 收藏 41 分享 8", "douyin");
    expect(draft).toMatchObject({ views: 3628, likes: 186, comments: 24, favorites: 41, shares: 8 });
  });

  test("normalizes Chinese ten-thousand units", () => {
    expect(extractMetricsFromText("阅读量 1.2万 点赞 356", "wechat")).toMatchObject({ views: 12000, likes: 356 });
  });

  test("requires platform content time views and one interaction", () => {
    expect(validateMinimumReviewFields({ platform: "douyin", title: "内容", publishedAt: "2026-08-01", views: 100 })).toContain("interactionMetric");
  });
});
