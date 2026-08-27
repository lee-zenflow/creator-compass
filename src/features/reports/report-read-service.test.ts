import { describe, expect, test, vi } from "vitest";

import type { CitationView } from "@/features/citations/citation-service";
import type { CurrentActor } from "@/features/identity/current-actor";
import type { ReportRecord } from "./report-service";
import {
  getReportDetail,
  getReportsLatestMeta,
  type RawReportVersion,
  type RawReportLatestVersionMeta,
  type ReportReadRepository,
} from "./report-read-service";

const owner: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "user",
};
const reportId = "20000000-0000-4000-8000-000000000002";
const itemId = "30000000-0000-4000-8000-000000000003";
const sourceId = "40000000-0000-4000-8000-000000000004";
const retrievalRecordId = "50000000-0000-4000-8000-000000000005";
const aiRunId = "60000000-0000-4000-8000-000000000006";
const projectId = "70000000-0000-4000-8000-000000000007";

const root: ReportRecord = {
  id: reportId,
  owner,
  type: "creation",
  title: "第一条视频",
  summary: "从定位到可执行脚本",
  status: "failed",
  createdAt: new Date("2026-08-20T08:00:00Z"),
  updatedAt: new Date("2026-08-20T09:00:00Z"),
};

function raw(overrides: Partial<RawReportVersion> = {}): RawReportVersion {
  return {
    id: "80000000-0000-4000-8000-000000000008",
    reportId,
    type: "creation",
    version: 1,
    status: "failed",
    createdAt: new Date("2026-08-20T08:30:00Z"),
    updatedAt: new Date("2026-08-20T08:40:00Z"),
    generationMode: "ai",
    model: "deepseek-chat",
    parentVersion: null,
    retrievalRecordId,
    aiRunId,
    aiStatus: "failed",
    aiErrorCode: "TIMEOUT",
    aiSafeErrorDetail: null,
    entityId: projectId,
    storedCitations: [{ itemId, sourceId }],
    ...overrides,
  };
}

function repository(
  versions: RawReportVersion[],
  foundRoot: ReportRecord | null = root,
  latest: RawReportLatestVersionMeta[] = versions.map((version) => ({
    reportId: version.reportId,
    type: version.type,
    version: version.version,
    generationMode: version.generationMode,
    entityId: version.entityId,
  })),
): ReportReadRepository {
  return {
    getRoot: vi.fn(async () => foundRoot),
    listTypedVersions: vi.fn(async () => versions),
    listLatestVersionMeta: vi.fn(async () => latest),
  };
}

const citation: CitationView = {
  itemId,
  sourceId,
  title: "真实案例",
  sourceName: "审核知识库",
  sourceType: "manual",
  summary: "已审核的案例摘要",
  reviewedAt: new Date("2026-08-19T08:00:00Z"),
  publicUrl: null,
};

describe("sanitized report detail", () => {
  test("batches latest list metadata without reading typed detail rows", async () => {
    const reviewRoot: ReportRecord = {
      ...root,
      id: "a0000000-0000-4000-8000-00000000000a",
      type: "review",
    };
    const readRepository = repository([], root, [
      {
        reportId,
        type: "creation",
        version: 2,
        generationMode: "manual",
        entityId: projectId,
      },
      {
        reportId: reviewRoot.id,
        type: "review",
        version: 3,
        generationMode: "ai",
        entityId: "b0000000-0000-4000-8000-00000000000b",
      },
    ]);

    await expect(getReportsLatestMeta(owner, [root, reviewRoot], readRepository)).resolves.toEqual([
      {
        reportId,
        version: 2,
        generationMode: "manual",
        domainHref: `/creation/${projectId}/plan?report=${reportId}&version=2`,
      },
      {
        reportId: reviewRoot.id,
        version: 3,
        generationMode: "ai",
        domainHref: `/reviews/b0000000-0000-4000-8000-00000000000b/report?report=${reviewRoot.id}&version=3`,
      },
    ]);
    expect(readRepository.listLatestVersionMeta).toHaveBeenCalledOnce();
    expect(readRepository.listTypedVersions).not.toHaveBeenCalled();
  });

  test("returns real provenance, domain links, failed recovery, and whitelisted citations", async () => {
    const resolveCitations = vi.fn(async () => [citation]);
    const detail = await getReportDetail(owner, reportId, {
      repository: repository([raw()]),
      resolveCitations,
      resolveLegacySources: vi.fn(async () => []),
    });

    expect(detail.versions[0]).toEqual({
      id: "80000000-0000-4000-8000-000000000008",
      version: 1,
      status: "failed",
      createdAt: new Date("2026-08-20T08:30:00Z"),
      updatedAt: new Date("2026-08-20T08:40:00Z"),
      generationMode: "ai",
      model: "deepseek-chat",
      parentVersion: null,
      entityId: projectId,
      domainHref: `/creation/${projectId}/plan?report=${reportId}&version=1`,
      aiStatus: "failed",
      citations: [citation],
      citationMode: "exact",
      legacySources: [],
      recoveryHref: `/creation/${projectId}/plan`,
    });
    expect(resolveCitations).toHaveBeenCalledWith(owner, retrievalRecordId, [{ itemId, sourceId }]);
    expect(detail.versions[0]!.citations[0]).not.toHaveProperty("objectKey");
    expect(detail.versions[0]!.citations[0]).not.toHaveProperty("score");
    expect(detail.versions[0]).not.toHaveProperty("retrievalRecordId");
    expect(detail.versions[0]).not.toHaveProperty("aiRunId");
    expect(detail.versions[0]).not.toHaveProperty("aiErrorCode");
    expect(detail.versions[0]).not.toHaveProperty("aiSafeErrorDetail");
  });

  test("offers recovery only for the latest retryable failed owned AI run", async () => {
    const detail = await getReportDetail(owner, reportId, {
      repository: repository([
        raw({
          id: "90000000-0000-4000-8000-000000000009",
          version: 2,
          aiSafeErrorDetail: "AI_INPUT_CHANGED",
        }),
        raw({ version: 1, aiErrorCode: "TIMEOUT", aiSafeErrorDetail: null }),
      ]),
      resolveCitations: vi.fn(async () => [citation]),
      resolveLegacySources: vi.fn(async () => []),
    });

    expect(detail.versions.map((version) => version.recoveryHref)).toEqual([null, null]);
  });

  test("inherits exact citation provenance for a manual child and never offers recovery", async () => {
    const resolveCitations = vi.fn(async () => [citation]);
    const detail = await getReportDetail(owner, reportId, {
      repository: repository([
        raw({
          id: "90000000-0000-4000-8000-000000000009",
          version: 2,
          status: "ready",
          generationMode: "manual",
          model: null,
          parentVersion: 1,
          retrievalRecordId: null,
          aiRunId: null,
          aiStatus: null,
          aiErrorCode: null,
          aiSafeErrorDetail: null,
        }),
        raw({ status: "ready", aiStatus: "ready" }),
      ]),
      resolveCitations,
      resolveLegacySources: vi.fn(async () => []),
    });

    expect(detail.versions[0]).toMatchObject({
      version: 2,
      generationMode: "manual",
      parentVersion: 1,
      citations: [citation],
      recoveryHref: null,
    });
    expect(resolveCitations).toHaveBeenCalledWith(owner, retrievalRecordId, [{ itemId, sourceId }]);
  });

  test("keeps legacy review citations source-only and never invents item ids", async () => {
    const resolveLegacySources = vi.fn(async () => [{
      id: sourceId,
      name: "历史审核资料",
      publicUrl: null,
    }]);
    const detail = await getReportDetail(owner, reportId, {
      repository: repository([raw({
        type: "review",
        entityId: "a0000000-0000-4000-8000-00000000000a",
        storedCitations: [sourceId],
      })], { ...root, type: "review" }),
      resolveCitations: vi.fn(async () => []),
      resolveLegacySources,
    });

    expect(detail.versions[0]).toMatchObject({
      citationMode: "legacy",
      citations: [],
      legacySources: [{ id: sourceId, name: "历史审核资料", publicUrl: null }],
    });
    expect(detail.versions[0]!.legacySources[0]).not.toHaveProperty("itemId");
  });

  test("rejects unknown or cross-owner roots", async () => {
    await expect(getReportDetail(owner, reportId, {
      repository: repository([], null),
      resolveCitations: vi.fn(async () => []),
      resolveLegacySources: vi.fn(async () => []),
    })).rejects.toThrow("NOT_FOUND");
  });
});
