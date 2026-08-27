import type { KnowledgeCandidate } from "./retrieve-knowledge";

const approved: KnowledgeCandidate = {
  kind: "knowledge",
  id: "expected-approved-item",
  sourceId: "approved-source",
  sourceName: "个人IP方法库",
  publicUrl: "https://example.com/ip",
  sourceReviewStatus: "approved",
  sourceRetrievalScope: "production",
  sourceIsDemo: false,
  sourceAllowAiSend: true,
  platform: "xiaohongshu",
  contentType: "note",
  tags: ["定位"],
  title: "定位方法",
  body: "从个人 IP 定位开始，明确目标用户和差异化价值。",
  itemReviewStatus: "approved",
  itemRetrievalScope: "production",
  itemIsDemo: false,
  enabled: true,
  validFrom: null,
  validUntil: null,
  version: 1,
  contentHash: "approved-hash",
  embedding: null,
};

export const knowledgeRegressionFixtures: KnowledgeCandidate[] = [
  approved,
  { ...approved, id: "pending", itemReviewStatus: "pending" },
  { ...approved, id: "rejected", itemReviewStatus: "rejected" },
  { ...approved, id: "disabled", enabled: false },
  { ...approved, id: "demo", itemIsDemo: true },
  { ...approved, id: "development_only", itemRetrievalScope: "development_only" },
  { ...approved, id: "pending-source", sourceReviewStatus: "pending" },
  { ...approved, id: "demo-source", sourceIsDemo: true },
];
