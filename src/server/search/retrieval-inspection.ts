import { desc, eq, sql } from "drizzle-orm";

import { db, type CreatorCompassDatabase } from "@/server/db/client";
import { knowledgeItems, knowledgeSources, platformRules } from "@/server/db/schema";

import {
  explainCandidate,
  type AdminKnowledgeInspectionRepository,
} from "./retrieval-explanation";
import {
  createDatabaseKnowledgeRepository,
  type KnowledgeCandidate,
  type KnowledgeRepository,
} from "./retrieve-knowledge";

export const ADMIN_KNOWLEDGE_INSPECTION_LIMIT = 200;
const DIAGNOSTIC_WINDOW_PER_KIND = 84;

export function createDatabaseAdminKnowledgeInspectionRepository(
  database: CreatorCompassDatabase,
  productionRepository: KnowledgeRepository = createDatabaseKnowledgeRepository(database),
): AdminKnowledgeInspectionRepository {
  return {
    limit: ADMIN_KNOWLEDGE_INSPECTION_LIMIT,
    async findInspectionCandidates(input, now) {
      const [productionCandidates, itemRows, ruleRows] = await Promise.all([
        productionRepository.findCandidates(input, now),
        database
          .select({
            id: knowledgeItems.id,
            sourceId: knowledgeSources.id,
            sourceName: knowledgeSources.name,
            publicUrl: knowledgeSources.publicUrl,
            sourceReviewStatus: knowledgeSources.reviewStatus,
            sourceRetrievalScope: knowledgeSources.retrievalScope,
            sourceIsDemo: knowledgeSources.isDemo,
            sourceAllowAiSend: knowledgeSources.allowAiSend,
            platform: knowledgeItems.platform,
            contentType: knowledgeItems.contentType,
            tags: knowledgeItems.tags,
            title: knowledgeItems.title,
            body: knowledgeItems.searchableText,
            itemReviewStatus: knowledgeItems.reviewStatus,
            itemRetrievalScope: knowledgeItems.retrievalScope,
            itemIsDemo: knowledgeItems.isDemo,
            enabled: knowledgeItems.enabled,
            version: knowledgeItems.version,
            contentHash: knowledgeItems.contentHash,
            embedding: knowledgeItems.embedding,
          })
          .from(knowledgeItems)
          .innerJoin(knowledgeSources, eq(knowledgeItems.knowledgeSourceId, knowledgeSources.id))
          .orderBy(desc(knowledgeItems.createdAt), desc(knowledgeItems.id))
          .limit(DIAGNOSTIC_WINDOW_PER_KIND),
        database
          .select({
            id: platformRules.id,
            sourceId: knowledgeSources.id,
            sourceName: knowledgeSources.name,
            publicUrl: knowledgeSources.publicUrl,
            sourceReviewStatus: knowledgeSources.reviewStatus,
            sourceRetrievalScope: knowledgeSources.retrievalScope,
            sourceIsDemo: knowledgeSources.isDemo,
            sourceAllowAiSend: knowledgeSources.allowAiSend,
            platform: platformRules.platform,
            title: platformRules.ruleType,
            body: platformRules.body,
            itemReviewStatus: platformRules.reviewStatus,
            itemRetrievalScope: platformRules.retrievalScope,
            enabled: platformRules.enabled,
            validFrom: platformRules.validFrom,
            validUntil: platformRules.validUntil,
            version: knowledgeSources.version,
            contentHash: platformRules.contentHash,
            embedding: sql<null>`null`,
          })
          .from(platformRules)
          .innerJoin(knowledgeSources, eq(platformRules.sourceId, knowledgeSources.id))
          .orderBy(desc(platformRules.createdAt), desc(platformRules.id))
          .limit(DIAGNOSTIC_WINDOW_PER_KIND),
      ]);

      const diagnostics: KnowledgeCandidate[] = [
        ...itemRows.map((row) => ({
          ...row,
          kind: "knowledge" as const,
          validFrom: null,
          validUntil: null,
          databaseRank: 0,
        })),
        ...ruleRows.map((row) => ({
          ...row,
          kind: "rule" as const,
          contentType: null,
          tags: [],
          itemIsDemo: false,
          databaseRank: 0,
        })),
      ];
      const productionKeys = new Set(
        productionCandidates.map((candidate) => `${candidate.kind}:${candidate.id}`),
      );
      const rejectedDiagnostics = diagnostics.filter((candidate) =>
        !productionKeys.has(`${candidate.kind}:${candidate.id}`) &&
        !explainCandidate(candidate, input, now).accepted,
      );
      return [...productionCandidates, ...rejectedDiagnostics]
        .slice(0, ADMIN_KNOWLEDGE_INSPECTION_LIMIT);
    },
  };
}

export const databaseAdminKnowledgeInspectionRepository =
  createDatabaseAdminKnowledgeInspectionRepository(db);
