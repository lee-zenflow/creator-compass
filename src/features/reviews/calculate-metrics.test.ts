import { describe, expect, test } from "vitest";

import { calculateMetrics, calculateReviewMetrics, REVIEW_METRIC_DEFINITIONS } from "./calculate-metrics";

describe("calculateMetrics", () => {
  test("ships explicit labels and formulas with the AI subject", () => {
    expect(REVIEW_METRIC_DEFINITIONS.calculated.interactionRate).toEqual(expect.objectContaining({
      label: "互动率",
      formula: "(点赞+评论+收藏+分享)/播放或阅读量",
    }));
  });
  test("keeps source metrics separate and derives deterministic rates", () => {
    expect(calculateMetrics({
      views: 1_000,
      likes: 40,
      comments: 8,
      favorites: 7,
      shares: 5,
      followersGained: 12,
    })).toEqual({
      interactionCount: 60,
      interactionRate: 0.06,
      followerConversionRate: 0.012,
      viewGrowthRate: null,
      interactionRateChange: null,
    });
  });

  test("does not invent a rate when the denominator is zero", () => {
    expect(calculateMetrics({ views: 0, likes: 3, comments: 0, favorites: 0, shares: 0 })).toEqual(expect.objectContaining({
      interactionCount: 3,
      interactionRate: null,
      followerConversionRate: null,
    }));
  });

  test("keeps derived metrics missing when required source fields are absent", () => {
    expect(calculateMetrics({ views: 1_000, likes: 40 })).toEqual(expect.objectContaining({
      interactionCount: null,
      interactionRate: null,
      followerConversionRate: null,
    }));
  });

  test("compares a repeated review with the prior confirmed snapshot", () => {
    expect(calculateMetrics(
      { views: 1_500, likes: 70, comments: 10, favorites: 5, shares: 5 },
      { views: 1_000, likes: 40, comments: 5, favorites: 3, shares: 2 },
    )).toEqual(expect.objectContaining({
      viewGrowthRate: 0.5,
      interactionRate: 0.06,
      interactionRateChange: 0.01,
    }));
  });

  test("fewer than three posts produce a data requirement instead of a trend conclusion", () => {
    const result = calculateReviewMetrics([
      { views: 100, likes: 5, comments: 1, favorites: 2, shares: 0, followersGained: 1 },
      { views: 120, likes: 6, comments: 1, favorites: 2, shares: 1, followersGained: 2 },
    ]);
    expect(result.historicalConclusion).toBeNull();
    expect(result.dataRequirement).toBe("至少需要 3 条已确认内容数据");
  });

  test("aggregates only complete confirmed fields and never estimates exposure", () => {
    const result = calculateReviewMetrics([
      { likes: 5, comments: 1, favorites: 2, shares: 0, followersGained: 1 },
      { likes: 6, comments: 1, favorites: 2, shares: 1, followersGained: 2 },
      { likes: 7, comments: 2, favorites: 3, shares: 1, followersGained: 1 },
    ]);
    expect(result.metrics).toEqual({
      views: null,
      interactionRate: null,
      followerConversionRate: null,
    });
    expect(result.historicalConclusion).toBeNull();
    expect(result.dataRequirement).toBe("需要已确认的播放或阅读量才能判断趋势");
  });

  test("allows a historical direction only after three confirmed posts", () => {
    const result = calculateReviewMetrics([
      { views: 100, likes: 5, comments: 1, favorites: 2, shares: 0, followersGained: 1 },
      { views: 120, likes: 6, comments: 1, favorites: 2, shares: 1, followersGained: 2 },
      { views: 150, likes: 7, comments: 2, favorites: 3, shares: 1, followersGained: 3 },
    ]);
    expect(result.metrics).toEqual({ views: 370, interactionRate: 0.083784, followerConversionRate: 0.016216 });
    expect(result.historicalConclusion).toBe("播放或阅读量较早期上升");
    expect(result.dataRequirement).toBeNull();
  });
});
