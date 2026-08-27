import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { buildSendDisclosure } from "./send-disclosure";

const actor: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "user",
};

describe("DeepSeek send disclosure", () => {
  test("lists mandatory business inputs, selected materials, and only sendable knowledge", async () => {
    const findOwnedSubject = vi.fn().mockResolvedValue({
      hmacPayload: {
        project: { contentType: "video", platform: "douyin", goal: "发布一条内容" },
        profile: { currentPositioning: "AI 产品学习" },
        selectedMaterials: [
          { id: "m1", name: "访谈笔记" },
          { id: "m2", name: "历史脚本" },
        ],
        historicalPlans: [],
      },
    });
    const retrieve = vi.fn().mockResolvedValue([
      { id: "k1", sourceId: "s1", sourceName: "平台规范", reviewStatus: "approved", retrievalScope: "production", enabled: true, isDemo: false },
      { id: "k2", sourceId: "s1", sourceName: "平台规范", reviewStatus: "approved", retrievalScope: "production", enabled: true, isDemo: false },
      { id: "k3", sourceId: "s2", sourceName: "未通过资料", reviewStatus: "pending", retrievalScope: "production", enabled: true, isDemo: false },
      { id: "k4", sourceId: "s3", sourceName: "已停用资料", reviewStatus: "approved", retrievalScope: "production", enabled: false, isDemo: false },
      { id: "k5", sourceId: "s4", sourceName: "演示资料", reviewStatus: "approved", retrievalScope: "production", enabled: true, isDemo: true },
    ]);

    const disclosure = await buildSendDisclosure(
      actor,
      "content_plan",
      "20000000-0000-4000-8000-000000000002",
      { findOwnedSubject, retrieve },
    );

    expect(disclosure.coreFields).toEqual(expect.arrayContaining([
      "本轮创作目标、平台、内容类型与补充要求",
      "当前创作者档案",
    ]));
    expect(disclosure.materials).toEqual(["访谈笔记", "历史脚本"]);
    expect(disclosure.sources).toEqual([{ id: "s1", label: "平台规范", chunkCount: 2 }]);
    expect(JSON.stringify(disclosure)).not.toMatch(/未通过资料|已停用资料|演示资料/);
  });

  test("fails closed when the business subject is not owned", async () => {
    await expect(buildSendDisclosure(actor, "review_report", crypto.randomUUID(), {
      findOwnedSubject: vi.fn().mockResolvedValue(null),
      retrieve: vi.fn(),
    })).rejects.toThrow("DISCLOSURE_SUBJECT_NOT_FOUND");
  });
});
