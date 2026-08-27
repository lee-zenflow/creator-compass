import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";

import { db, type CreatorCompassDatabase } from "@/server/db/client";
import { knowledgeItems, knowledgeSources, platformRules } from "@/server/db/schema";
import { localEmbeddingClient } from "./embedding-client";
import { reciprocalRankFusion } from "./rank-fusion";
import { explainCandidate } from "./retrieval-explanation";

type ReviewStatus = "pending" | "approved" | "rejected";
type RetrievalScope = "production" | "development_only";

export type RetrievalInput = {
  platform: string;
  contentType: string;
  tags: string[];
  keywords: string[];
};

export type NormalizedRetrievalInput = RetrievalInput & {
  platform: string;
  contentType: string;
  tags: string[];
  keywords: string[];
};

export type KnowledgeCandidate = {
  kind: "knowledge" | "rule";
  id: string;
  sourceId: string;
  sourceName: string;
  publicUrl: string | null;
  sourceReviewStatus: ReviewStatus;
  sourceRetrievalScope: RetrievalScope;
  sourceIsDemo: boolean;
  sourceAllowAiSend: boolean;
  platform: string | null;
  contentType: string | null;
  tags: string[];
  title: string;
  body: string;
  itemReviewStatus: ReviewStatus;
  itemRetrievalScope: RetrievalScope;
  itemIsDemo: boolean;
  enabled: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  version: number;
  contentHash: string;
  databaseRank?: number;
  embedding: number[] | null;
};

export type KnowledgeHit = {
  kind: KnowledgeCandidate["kind"];
  id: string;
  sourceId: string;
  sourceName: string;
  publicUrl: string | null;
  title: string;
  body: string;
  version: number;
  contentHash: string;
  reviewStatus: "approved";
  score: number;
  matchMode: "hybrid" | "deterministic_text";
};

export interface KnowledgeRepository {
  findCandidates(input: NormalizedRetrievalInput, now: Date): Promise<KnowledgeCandidate[]>;
  findSemanticCandidates?(
    input: NormalizedRetrievalInput,
    now: Date,
  ): Promise<KnowledgeCandidate[]>;
}

export type KnowledgeRetrievalResult = {
  hits: KnowledgeHit[];
  matchMode: KnowledgeHit["matchMode"];
  degradationReason: "EMBEDDING_UNAVAILABLE" | "INVALID_RESPONSE" | null;
};

export type EmbeddingQueryClient = {
  embedQuery(text: string): Promise<{ vector: number[]; model: string; version: string; dimensions: 512 }>;
};

function normalizeTerm(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizeTerms(values: readonly string[]) {
  return [...new Set(values.map(normalizeTerm).filter(Boolean))].sort();
}

function compactText(value: string) {
  return normalizeTerm(value).replace(/\s+/gu, "");
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function normalizeRetrievalInput(input: RetrievalInput): NormalizedRetrievalInput {
  const normalized = {
    platform: normalizeTerm(input.platform),
    contentType: normalizeTerm(input.contentType),
    tags: normalizeTerms(input.tags),
    keywords: normalizeTerms(input.keywords),
  };
  if (
    !normalized.platform ||
    normalized.platform.length > 64 ||
    !normalized.contentType ||
    normalized.contentType.length > 64 ||
    normalized.tags.length > 20 ||
    normalized.keywords.length > 20 ||
    [...normalized.tags, ...normalized.keywords].some((term) => term.length > 80)
  ) {
    throw new Error("INVALID_RETRIEVAL_INPUT");
  }
  return normalized;
}

export function createDatabaseKnowledgeRepository(
  database: CreatorCompassDatabase,
): KnowledgeRepository {
  return {
    async findCandidates(input, now) {
    const searchDocument = input.keywords.join(" ");
    const webSearchDocument = input.keywords.join(" OR ");
    const compactSearchDocument = input.keywords.map(compactText).join("");
    const substringPattern = `%${escapeLikePattern(compactSearchDocument)}%`;
    const hasSearchTerms = input.tags.length > 0 || input.keywords.length > 0;
    const tagMatch = input.tags.length > 0
      ? sql`${knowledgeItems.tags} ?| ${input.tags}::text[]`
      : sql`false`;
    const trigramRank = sql<number>`(
      case when ${searchDocument} = '' then 0 else greatest(
        similarity(${knowledgeItems.searchableText}, ${searchDocument}),
        case when regexp_replace(${knowledgeItems.searchableText}, '\\s+', '', 'g') ilike ${substringPattern} escape '\\' then 1 else 0 end
      ) end
    )`;
    const ftsRank = sql<number>`(
      case when ${searchDocument} = '' then 0 else
        ts_rank_cd(
          to_tsvector('simple', ${knowledgeItems.searchableText}),
          websearch_to_tsquery('simple', ${webSearchDocument})
        )
      end
    )`;
    const itemDatabaseRank = sql<number>`(
      case when ${tagMatch} then 5 else 0 end
      + (${trigramRank} * 4)
      + ${ftsRank}
    )`;
    const relevancePredicate = hasSearchTerms
      ? or(
          tagMatch,
          ...(searchDocument
            ? [
                sql`regexp_replace(${knowledgeItems.searchableText}, '\\s+', '', 'g') ilike ${substringPattern} escape '\\'`,
                sql`similarity(${knowledgeItems.searchableText}, ${searchDocument}) >= 0.15`,
                sql`to_tsvector('simple', ${knowledgeItems.searchableText}) @@ websearch_to_tsquery('simple', ${webSearchDocument})`,
              ]
            : []),
        )
      : sql`true`;
    const itemRows = await database
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
        databaseRank: itemDatabaseRank,
      })
      .from(knowledgeItems)
      .innerJoin(knowledgeSources, eq(knowledgeItems.knowledgeSourceId, knowledgeSources.id))
      .where(
        and(
          or(eq(knowledgeItems.platform, input.platform), eq(knowledgeItems.platform, "all")),
          or(eq(knowledgeItems.contentType, input.contentType), eq(knowledgeItems.contentType, "general"), eq(knowledgeItems.contentType, "all")),
          eq(knowledgeItems.reviewStatus, "approved"),
          eq(knowledgeItems.retrievalScope, "production"),
          eq(knowledgeItems.isDemo, false),
          eq(knowledgeItems.enabled, true),
          eq(knowledgeSources.reviewStatus, "approved"),
          eq(knowledgeSources.retrievalScope, "production"),
          eq(knowledgeSources.isDemo, false),
          eq(knowledgeSources.allowAiSend, true),
          relevancePredicate,
        ),
      )
      .orderBy(desc(itemDatabaseRank), asc(knowledgeItems.id))
      .limit(16);

    const ruleDatabaseRank = sql<number>`(
      case when ${searchDocument} = '' then 0 else
        ts_rank_cd(
          to_tsvector('simple', ${platformRules.body}),
          websearch_to_tsquery('simple', ${webSearchDocument})
        )
      end
    )`;

    const ruleRows = await database
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
        version: knowledgeSources.version,
        contentHash: platformRules.contentHash,
        embedding: sql<null>`null`,
        enabled: platformRules.enabled,
        validFrom: platformRules.validFrom,
        validUntil: platformRules.validUntil,
        databaseRank: ruleDatabaseRank,
      })
      .from(platformRules)
      .innerJoin(knowledgeSources, eq(platformRules.sourceId, knowledgeSources.id))
      .where(
        and(
          or(eq(platformRules.platform, input.platform), eq(platformRules.platform, "all")),
          eq(platformRules.enabled, true),
          eq(platformRules.reviewStatus, "approved"),
          eq(platformRules.retrievalScope, "production"),
          eq(knowledgeSources.reviewStatus, "approved"),
          eq(knowledgeSources.retrievalScope, "production"),
          eq(knowledgeSources.isDemo, false),
          eq(knowledgeSources.allowAiSend, true),
          or(isNull(platformRules.validFrom), lte(platformRules.validFrom, now)),
          or(isNull(platformRules.validUntil), gte(platformRules.validUntil, now)),
        ),
      )
      .orderBy(desc(ruleDatabaseRank), asc(platformRules.id))
      .limit(16);

    return [
      ...itemRows.map((row) => ({
        ...row,
        kind: "knowledge" as const,
        validFrom: null,
        validUntil: null,
      })),
      ...ruleRows.map((row) => ({
        ...row,
        kind: "rule" as const,
        contentType: null,
        tags: [],
        itemIsDemo: false,
      })),
    ];
    },
    async findSemanticCandidates(input) {
      const rows = await database
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
        .where(and(
          or(eq(knowledgeItems.platform, input.platform), eq(knowledgeItems.platform, "all")),
          or(eq(knowledgeItems.contentType, input.contentType), eq(knowledgeItems.contentType, "general"), eq(knowledgeItems.contentType, "all")),
          eq(knowledgeItems.reviewStatus, "approved"),
          eq(knowledgeItems.retrievalScope, "production"),
          eq(knowledgeItems.isDemo, false),
          eq(knowledgeItems.enabled, true),
          eq(knowledgeItems.embeddingStatus, "ready"),
          sql`${knowledgeItems.embedding} is not null`,
          eq(knowledgeSources.reviewStatus, "approved"),
          eq(knowledgeSources.retrievalScope, "production"),
          eq(knowledgeSources.isDemo, false),
          eq(knowledgeSources.allowAiSend, true),
        ))
        .orderBy(asc(knowledgeItems.id))
        .limit(96);
      return rows.map((row) => ({
        ...row,
        kind: "knowledge" as const,
        validFrom: null,
        validUntil: null,
        databaseRank: 0,
      }));
    },
  };
}

export const databaseKnowledgeRepository = createDatabaseKnowledgeRepository(db);

function lexicalRanking(
  candidates: readonly KnowledgeCandidate[],
  normalized: NormalizedRetrievalInput,
  now: Date,
) {
  return candidates
    .filter((candidate) => candidate.sourceAllowAiSend)
    .map((candidate) => ({ candidate, explanation: explainCandidate(candidate, normalized, now) }))
    .filter(({ explanation }) => explanation.accepted)
    .map(({ candidate, explanation }) => ({ candidate, score: explanation.totalScore }))
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length !== 512 || right.length !== 512) return null;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < 512; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    dot += a! * b!;
    leftMagnitude += a! * a!;
    rightMagnitude += b! * b!;
  }
  if (leftMagnitude <= 0 || rightMagnitude <= 0) return null;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function selectHits(
  ranked: Array<{ candidate: KnowledgeCandidate; score: number }>,
  matchMode: KnowledgeHit["matchMode"],
) {
  const selected: typeof ranked = [];
  const sourceCounts = new Map<string, number>();
  for (const entry of ranked) {
    const count = sourceCounts.get(entry.candidate.sourceId) ?? 0;
    if (count >= 3) continue;
    selected.push(entry);
    sourceCounts.set(entry.candidate.sourceId, count + 1);
    if (selected.length === 8) break;
  }
  return selected.map(({ candidate, score }) => ({
    kind: candidate.kind,
    id: candidate.id,
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceName,
    publicUrl: candidate.publicUrl,
    title: candidate.title,
    body: candidate.body,
    version: candidate.version,
    contentHash: candidate.contentHash,
    reviewStatus: "approved" as const,
    score,
    matchMode,
  }));
}

export async function retrieveKnowledgeWithStatus(
  input: RetrievalInput,
  repository: KnowledgeRepository = databaseKnowledgeRepository,
  now = new Date(),
  embeddingClient: EmbeddingQueryClient = localEmbeddingClient,
): Promise<KnowledgeRetrievalResult> {
  const normalized = normalizeRetrievalInput(input);
  const candidates = await repository.findCandidates(normalized, now);
  const lexical = lexicalRanking(candidates, normalized, now);
  if (!repository.findSemanticCandidates) {
    return { hits: selectHits(lexical, "deterministic_text"), matchMode: "deterministic_text", degradationReason: null };
  }

  const semanticCandidates = (await repository.findSemanticCandidates(normalized, now))
    .filter((candidate) => candidate.sourceAllowAiSend && candidate.embedding);
  if (semanticCandidates.length === 0) {
    return { hits: selectHits(lexical, "deterministic_text"), matchMode: "deterministic_text", degradationReason: null };
  }
  try {
    const query = [normalized.platform, normalized.contentType, ...normalized.tags, ...normalized.keywords].join(" ");
    const embedded = await embeddingClient.embedQuery(query);
    const semantic = semanticCandidates.flatMap((candidate) => {
      const governance = explainCandidate(candidate, normalized, now);
      if (governance.reasons.some((reason) => reason !== "NO_DETERMINISTIC_MATCH")) return [];
      const similarity = cosineSimilarity(embedded.vector, candidate.embedding!);
      return similarity !== null && similarity >= 0.15 ? [{ candidate, similarity }] : [];
    }).sort((left, right) => right.similarity - left.similarity || left.candidate.id.localeCompare(right.candidate.id));
    const fused = reciprocalRankFusion({
      lexical: lexical.map(({ candidate }) => candidate.id),
      semantic: semantic.map(({ candidate }) => candidate.id),
    });
    const byId = new Map([
      ...lexical.map(({ candidate }) => [candidate.id, candidate] as const),
      ...semantic.map(({ candidate }) => [candidate.id, candidate] as const),
    ]);
    const ranked = fused.flatMap((entry) => {
      const candidate = byId.get(entry.id);
      return candidate ? [{ candidate, score: entry.score * 1_000 }] : [];
    });
    return { hits: selectHits(ranked, "hybrid"), matchMode: "hybrid", degradationReason: null };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof Error ? error.message : "EMBEDDING_UNAVAILABLE";
    const degradationReason = code === "INVALID_RESPONSE" ? "INVALID_RESPONSE" : "EMBEDDING_UNAVAILABLE";
    return {
      hits: selectHits(lexical, "deterministic_text"),
      matchMode: "deterministic_text",
      degradationReason,
    };
  }
}

export async function retrieveKnowledge(
  input: RetrievalInput,
  repository: KnowledgeRepository = databaseKnowledgeRepository,
  now = new Date(),
): Promise<KnowledgeHit[]> {
  return (await retrieveKnowledgeWithStatus(input, repository, now)).hits;
}
