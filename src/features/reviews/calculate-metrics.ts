export type ConfirmedMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
  favorites?: number;
  shares?: number;
  followersGained?: number;
};

export type CalculatedMetrics = {
  interactionCount: number | null;
  interactionRate: number | null;
  followerConversionRate: number | null;
  viewGrowthRate: number | null;
  interactionRateChange: number | null;
};

export type ReviewAggregateMetrics = {
  views: number | null;
  interactionRate: number | null;
  followerConversionRate: number | null;
};

export type ReviewMetricsSummary = {
  metrics: ReviewAggregateMetrics | null;
  historicalConclusion: string | null;
  dataRequirement: string | null;
};

export const REVIEW_METRIC_DEFINITIONS = {
  confirmed: {
    views: { label: "播放或阅读量", source: "用户确认的原始数据" },
    likes: { label: "点赞", source: "用户确认的原始数据" },
    comments: { label: "评论", source: "用户确认的原始数据" },
    favorites: { label: "收藏", source: "用户确认的原始数据" },
    shares: { label: "分享", source: "用户确认的原始数据" },
    followersGained: { label: "本次涨粉", source: "用户确认的原始数据" },
  },
  calculated: {
    interactionCount: { label: "互动总数", formula: "点赞+评论+收藏+分享" },
    interactionRate: { label: "互动率", formula: "(点赞+评论+收藏+分享)/播放或阅读量" },
    followerConversionRate: { label: "涨粉转化率", formula: "本次涨粉/播放或阅读量" },
    viewGrowthRate: { label: "播放增长率", formula: "(本次播放-上次播放)/上次播放" },
    interactionRateChange: { label: "互动率变化", formula: "本次互动率-上次互动率" },
  },
  missingValueRule: "任何必需原始字段缺失或分母为0时，计算值保持null，不按0补齐。",
} as const;

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function interactions(metrics: ConfirmedMetrics) {
  const values = [metrics.likes, metrics.comments, metrics.favorites, metrics.shares];
  if (values.some((value) => value === undefined)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function rate(numerator: number | null, denominator?: number) {
  return numerator !== null && denominator && denominator > 0 ? round(numerator / denominator) : null;
}

export function calculateMetrics(
  current: ConfirmedMetrics,
  previous?: ConfirmedMetrics | null,
): CalculatedMetrics {
  const interactionCount = interactions(current);
  const interactionRate = rate(interactionCount, current.views);
  const previousInteractionRate = previous
    ? rate(interactions(previous), previous.views)
    : null;

  return {
    interactionCount,
    interactionRate,
    followerConversionRate: rate(current.followersGained ?? null, current.views),
    viewGrowthRate: previous?.views && current.views !== undefined
      ? round((current.views - previous.views) / previous.views)
      : null,
    interactionRateChange: interactionRate !== null && previousInteractionRate !== null
      ? round(interactionRate - previousInteractionRate)
      : null,
  };
}

function completeSum(snapshots: ConfirmedMetrics[], key: keyof ConfirmedMetrics) {
  const values = snapshots.map((snapshot) => snapshot[key]);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function calculateReviewMetrics(snapshots: ConfirmedMetrics[]): ReviewMetricsSummary {
  if (snapshots.length === 0) {
    return {
      metrics: null,
      historicalConclusion: null,
      dataRequirement: "至少需要 3 条已确认内容数据",
    };
  }

  const views = completeSum(snapshots, "views");
  const interactionParts = (["likes", "comments", "favorites", "shares"] as const)
    .map((key) => completeSum(snapshots, key));
  const interactionCount = interactionParts.some((value) => value === null)
    ? null
    : interactionParts.reduce<number>((total, value) => total + (value ?? 0), 0);
  const followersGained = completeSum(snapshots, "followersGained");
  const metrics: ReviewAggregateMetrics = {
    views,
    interactionRate: rate(interactionCount, views ?? undefined),
    followerConversionRate: rate(followersGained, views ?? undefined),
  };

  if (snapshots.length < 3) {
    return {
      metrics,
      historicalConclusion: null,
      dataRequirement: "至少需要 3 条已确认内容数据",
    };
  }

  const firstViews = snapshots[0]?.views;
  const latestViews = snapshots.at(-1)?.views;
  if (typeof firstViews !== "number" || typeof latestViews !== "number") {
    return {
      metrics,
      historicalConclusion: null,
      dataRequirement: "需要已确认的播放或阅读量才能判断趋势",
    };
  }

  return {
    metrics,
    historicalConclusion: latestViews === firstViews
      ? "播放或阅读量与早期持平"
      : latestViews > firstViews
        ? "播放或阅读量较早期上升"
        : "播放或阅读量较早期下降",
    dataRequirement: null,
  };
}
