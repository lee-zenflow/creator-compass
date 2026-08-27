import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { CreatorCompassDatabase } from "@/server/db/client";
import * as schema from "@/server/db/schema";

import {
  createDatabaseKnowledgeRepository,
  retrieveKnowledge,
  retrieveKnowledgeWithStatus,
  type KnowledgeCandidate,
  type KnowledgeRepository,
} from "./retrieve-knowledge";
import { knowledgeRegressionFixtures } from "./knowledge-regression-fixtures";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

const now = new Date("2026-08-08T12:00:00Z");

function candidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    kind: "knowledge",
    id: "item-1",
    sourceId: "source-1",
    sourceName: "公开资料",
    publicUrl: "https://example.com/source",
    sourceReviewStatus: "approved",
    sourceRetrievalScope: "production",
    sourceIsDemo: false,
    sourceAllowAiSend: true,
    platform: "douyin",
    contentType: "video",
    tags: ["效率工具"],
    title: "效率工具内容结构",
    body: "考试周效率工具的短视频内容结构",
    itemReviewStatus: "approved",
    itemRetrievalScope: "production",
    itemIsDemo: false,
    enabled: true,
    validFrom: null,
    validUntil: null,
    version: 1,
    contentHash: "hash-1",
    embedding: null,
    ...overrides,
  };
}

class MemoryKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly candidates: KnowledgeCandidate[]) {}
  async findCandidates() {
    return this.candidates;
  }
}

class HybridMemoryKnowledgeRepository extends MemoryKnowledgeRepository {
  constructor(
    lexical: KnowledgeCandidate[],
    private readonly semantic: KnowledgeCandidate[],
  ) { super(lexical); }
  async findSemanticCandidates() { return this.semantic; }
}

describe("retrieveKnowledge", () => {
  test("requires production approval for both source and knowledge item", async () => {
    const repository = new MemoryKnowledgeRepository([
      candidate(),
      candidate({ id: "pending-source", sourceReviewStatus: "pending" }),
      candidate({ id: "demo-source", sourceIsDemo: true }),
      candidate({ id: "pending-item", itemReviewStatus: "pending" }),
      candidate({ id: "development-item", itemRetrievalScope: "development_only" }),
    ]);

    const hits = await retrieveKnowledge(
      { platform: "douyin", contentType: "video", tags: [], keywords: [] },
      repository,
      now,
    );

    expect(hits.map((hit) => hit.id)).toEqual(["item-1"]);
  });

  test("requires platform rules to be enabled, current, approved, and backed by an approved source", async () => {
    const activeRule = candidate({
      kind: "rule",
      id: "rule-active",
      contentType: null,
      title: "发布规范",
      body: "抖音视频发布规范",
      validFrom: new Date("2026-08-01T00:00:00Z"),
      validUntil: new Date("2026-09-01T00:00:00Z"),
    });
    const repository = new MemoryKnowledgeRepository([
      activeRule,
      { ...activeRule, id: "rule-disabled", enabled: false },
      { ...activeRule, id: "rule-expired", validUntil: new Date("2026-08-07T00:00:00Z") },
      { ...activeRule, id: "rule-unreviewed", itemReviewStatus: "pending" },
      { ...activeRule, id: "rule-source-unreviewed", sourceReviewStatus: "pending" },
    ]);

    const hits = await retrieveKnowledge(
      { platform: "douyin", contentType: "video", tags: [], keywords: ["发布"] },
      repository,
      now,
    );
    expect(hits.map((hit) => hit.id)).toEqual(["rule-active"]);
  });

  test("uses exact platform and content type filters for knowledge items", async () => {
    const repository = new MemoryKnowledgeRepository([
      candidate(),
      candidate({ id: "wrong-platform", platform: "bilibili" }),
      candidate({ id: "wrong-type", contentType: "article" }),
      candidate({ id: "missing-platform", platform: null }),
    ]);

    const hits = await retrieveKnowledge(
      { platform: "douyin", contentType: "video", tags: [], keywords: [] },
      repository,
      now,
    );
    expect(hits.map((hit) => hit.id)).toEqual(["item-1"]);
  });

  test("returns no knowledge case when non-empty search terms have no deterministic match", async () => {
    const repository = new MemoryKnowledgeRepository([
      candidate({ tags: ["穿搭"], title: "夏季搭配", body: "服装配色方法" }),
    ]);

    const hits = await retrieveKnowledge(
      { platform: "douyin", contentType: "video", tags: ["效率工具"], keywords: ["考试周"] },
      repository,
      now,
    );
    expect(hits).toEqual([]);
  });

  test("retrieves a semantic-only match and reports hybrid mode", async () => {
    const semantic = candidate({
      id: "semantic-match",
      title: "精力管理框架",
      body: "用三段式方法安排备考期的内容制作",
      embedding: Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0),
    });
    const result = await retrieveKnowledgeWithStatus(
      { platform: "douyin", contentType: "video", tags: [], keywords: ["考试周效率"] },
      new HybridMemoryKnowledgeRepository([], [semantic]),
      now,
      { embedQuery: async () => ({
        model: "BAAI/bge-small-zh-v1.5",
        version: "1",
        dimensions: 512 as const,
        vector: Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0),
      }) },
    );

    expect(result.matchMode).toBe("hybrid");
    expect(result.degradationReason).toBeNull();
    expect(result.hits[0]).toMatchObject({ id: "semantic-match", matchMode: "hybrid" });
  });

  test("falls back explicitly when the local embedding service is unavailable", async () => {
    const lexical = candidate({
      title: "考试周效率",
      body: "考试周效率工具的短视频结构",
      embedding: Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0),
    });
    const result = await retrieveKnowledgeWithStatus(
      { platform: "douyin", contentType: "video", tags: [], keywords: ["考试周"] },
      new HybridMemoryKnowledgeRepository([lexical], [lexical]),
      now,
      { embedQuery: async () => { throw new Error("EMBEDDING_UNAVAILABLE"); } },
    );

    expect(result).toMatchObject({
      matchMode: "deterministic_text",
      degradationReason: "EMBEDDING_UNAVAILABLE",
    });
    expect(result.hits[0]?.id).toBe("item-1");
  });

  test("never sends a source without explicit AI authorization", async () => {
    const hits = await retrieveKnowledge(
      { platform: "douyin", contentType: "video", tags: [], keywords: [] },
      new MemoryKnowledgeRepository([candidate({ sourceAllowAiSend: false })]),
      now,
    );
    expect(hits).toEqual([]);
  });

  test("normalizes terms, ranks deterministically, and returns at most eight", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      candidate({
        id: `item-${String(index).padStart(2, "0")}`,
        sourceId: `source-${index}`,
        tags: index === 4 ? ["效率工具", "考试周"] : ["其他"],
        title: index === 4 ? "考试周效率工具" : `普通标题 ${index}`,
        body: index === 4 ? "考试周 效率工具 完整方法" : `效率工具 普通内容 ${index}`,
        contentHash: `hash-${index}`,
      }),
    );
    const repository = new MemoryKnowledgeRepository(candidates.reverse());

    const hits = await retrieveKnowledge(
      {
        platform: " DOUYIN ",
        contentType: " VIDEO ",
        tags: [" 效率工具 ", "考试周"],
        keywords: ["考试周", "效率工具"],
      },
      repository,
      now,
    );

    expect(hits).toHaveLength(8);
    expect(hits[0]?.id).toBe("item-04");
    expect(hits.map((hit) => hit.id)).toEqual([...hits.map((hit) => hit.id)].sort((a, b) => {
      const left = hits.find((hit) => hit.id === a)!;
      const right = hits.find((hit) => hit.id === b)!;
      return right.score - left.score || a.localeCompare(b);
    }));
    expect(hits.every((hit) => hit.matchMode === "deterministic_text")).toBe(true);
  });

  test("limits repeated chunks from one source so a long document cannot occupy all results", async () => {
    const dominant = Array.from({ length: 9 }, (_, index) => candidate({
      id: `dominant-${index}`,
      sourceId: "source-dominant",
      sourceName: "超长来源",
      title: `个人IP定位方法 ${index}`,
      body: "个人IP定位 目标人群 内容方向",
      contentHash: `dominant-hash-${index}`,
    }));
    const alternate = candidate({
      id: "alternate-source",
      sourceId: "source-alternate",
      sourceName: "独立来源",
      title: "个人IP定位补充案例",
      body: "个人IP定位的目标人群验证",
      contentHash: "alternate-hash",
    });

    const hits = await retrieveKnowledge(
      { platform: "douyin", contentType: "video", tags: [], keywords: ["个人IP定位"] },
      new MemoryKnowledgeRepository([...dominant, alternate]),
      now,
    );

    expect(hits.filter((hit) => hit.sourceId === "source-dominant")).toHaveLength(3);
    expect(hits.some((hit) => hit.sourceId === "source-alternate")).toBe(true);
  });

  test("continuous Chinese query retrieves an approved chunk even when the source text has spaces", async () => {
    const hits = await retrieveKnowledge(
      {
        platform: "xiaohongshu",
        contentType: "note",
        tags: [],
        keywords: ["个人IP定位"],
      },
      new MemoryKnowledgeRepository(knowledgeRegressionFixtures),
      now,
    );
    expect(hits[0]?.id).toBe("expected-approved-item");
  });

  test.each(["pending", "rejected", "disabled", "demo", "development_only", "pending-source", "demo-source"])(
    "never returns the %s regression fixture",
    async (fixture) => {
      const hits = await retrieveKnowledge(
        {
          platform: "xiaohongshu",
          contentType: "note",
          tags: ["定位"],
          keywords: ["个人IP定位"],
        },
        new MemoryKnowledgeRepository(knowledgeRegressionFixtures),
        now,
      );
      expect(hits.some((hit) => hit.id === fixture)).toBe(false);
    },
  );
});

integration("database knowledge retrieval", () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });
  const database = drizzle({ client: pool, schema });

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  });

  afterAll(async () => {
    await pool.end();
  });

  test("allows keyword retrieval when the tag list is empty", async () => {
    const repository = createDatabaseKnowledgeRepository(
      database as unknown as CreatorCompassDatabase,
    );

    await expect(repository.findCandidates({
      platform: "all",
      contentType: "positioning",
      tags: [],
      keywords: ["真实复盘"],
    }, now)).resolves.toEqual(expect.any(Array));
  });
});
