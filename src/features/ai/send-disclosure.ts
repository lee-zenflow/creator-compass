import type { CurrentActor } from "@/features/identity/current-actor";
import { buildRetrievalInput } from "@/server/ai/execute-ai-task";
import { databaseAiRunRepository } from "@/server/ai/run-ai-task";
import type { AiTaskType } from "@/server/ai/ai-schemas";
import { retrieveKnowledge } from "@/server/search/retrieve-knowledge";

export type SendDisclosureSource = {
  id: string;
  label: string;
  chunkCount: number;
};

export type SendDisclosure = {
  provider: "DeepSeek";
  model: "deepseek-v4-flash";
  coreFields: string[];
  materials: string[];
  sources: SendDisclosureSource[];
};

type Candidate = {
  id: string;
  sourceId: string;
  sourceName: string;
  reviewStatus: "pending" | "approved" | "rejected";
  retrievalScope: "production" | "development_only";
  enabled: boolean;
  isDemo: boolean;
};

type Dependencies = {
  findOwnedSubject(
    actor: CurrentActor,
    taskType: AiTaskType,
    entityId: string,
  ): Promise<{ hmacPayload: unknown } | null>;
  retrieve(taskType: AiTaskType, subjectData: unknown): Promise<Candidate[]>;
};

const coreFields: Record<AiTaskType, string[]> = {
  profile_extract: ["本轮回答（提交时）", "当前访谈记录", "已有画像维度"],
  positioning_report: ["完整访谈记录", "当前画像与定位约束"],
  content_plan: ["本轮创作目标、平台、内容类型与补充要求", "当前创作者档案", "已确认历史方案摘要"],
  review_report: ["内容标题、平台与发布时间", "已确认发布数据", "系统计算指标与口径"],
};

function materialNames(subjectData: unknown) {
  if (!subjectData || typeof subjectData !== "object") return [];
  const selected = (subjectData as Record<string, unknown>).selectedMaterials;
  if (!Array.isArray(selected)) return [];
  return selected.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const name = (item as Record<string, unknown>).name;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  }).slice(0, 20);
}

function groupSendableSources(candidates: Candidate[]): SendDisclosureSource[] {
  const grouped = new Map<string, SendDisclosureSource>();
  for (const candidate of candidates) {
    if (
      candidate.reviewStatus !== "approved" ||
      candidate.retrievalScope !== "production" ||
      !candidate.enabled ||
      candidate.isDemo
    ) continue;
    const current = grouped.get(candidate.sourceId);
    if (current) current.chunkCount += 1;
    else grouped.set(candidate.sourceId, {
      id: candidate.sourceId,
      label: candidate.sourceName,
      chunkCount: 1,
    });
  }
  return [...grouped.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

const databaseDependencies: Dependencies = {
  findOwnedSubject: (actor, taskType, entityId) =>
    databaseAiRunRepository.findOwnedSubject(actor, taskType, entityId),
  async retrieve(taskType, subjectData) {
    const hits = await retrieveKnowledge(buildRetrievalInput(taskType, subjectData));
    return hits.map((hit) => ({
      id: hit.id,
      sourceId: hit.sourceId,
      sourceName: hit.sourceName,
      reviewStatus: hit.reviewStatus,
      retrievalScope: "production" as const,
      enabled: true,
      isDemo: false,
    }));
  },
};

export async function buildSendDisclosure(
  actor: CurrentActor,
  taskType: AiTaskType,
  entityId: string,
  dependencies: Dependencies = databaseDependencies,
): Promise<SendDisclosure> {
  const subject = await dependencies.findOwnedSubject(actor, taskType, entityId);
  if (!subject) throw new Error("DISCLOSURE_SUBJECT_NOT_FOUND");
  const candidates = await dependencies.retrieve(taskType, subject.hmacPayload);
  return {
    provider: "DeepSeek",
    model: "deepseek-v4-flash",
    coreFields: coreFields[taskType],
    materials: taskType === "content_plan" ? materialNames(subject.hmacPayload) : [],
    sources: groupSendableSources(candidates),
  };
}

export function buildFallbackSendDisclosure(taskType: AiTaskType): SendDisclosure {
  return {
    provider: "DeepSeek",
    model: "deepseek-v4-flash",
    coreFields: coreFields[taskType],
    materials: taskType === "content_plan" ? ["本次提交时勾选的本地素材（仅所选项）"] : [],
    sources: [],
  };
}

export function buildDraftReviewDisclosure(): SendDisclosure {
  return buildFallbackSendDisclosure("review_report");
}
