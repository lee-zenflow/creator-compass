import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db } from "@/server/db/client";
import { knowledgeItems, knowledgeSources, retrievalRecords } from "@/server/db/schema";

const citationPairSchema = z.object({ itemId: z.uuid(), sourceId: z.uuid() }).strict();
const citationPairsSchema = z.array(citationPairSchema).max(32);
const snapshotHitSchema = citationPairSchema.extend({
  itemVersion: z.number().int().positive(),
  contentHash: z.string().min(1).max(256),
  rank: z.number().int().positive(),
  score: z.number().finite().nullable(),
  selected: z.boolean(),
}).strict();
const citationViewSchema = citationPairSchema.extend({
  title: z.string().trim().min(1).max(500),
  sourceName: z.string().trim().min(1).max(500),
  sourceType: z.string().trim().min(1).max(120),
  summary: z.string().max(4_000),
  reviewedAt: z.date().nullable(),
  publicUrl: z.url().nullable(),
}).strict();

export type CitationPair = z.infer<typeof citationPairSchema>;
export type CitationView = z.infer<typeof citationViewSchema>;

export interface CitationRepository {
  getActorSnapshot(actor: CurrentActor, retrievalRecordId: string): Promise<unknown[] | null>;
  resolvePairs(pairs: CitationPair[]): Promise<unknown[]>;
}

export const databaseCitationRepository: CitationRepository = {
  async getActorSnapshot(actor, retrievalRecordId) {
    const owner = actor.kind === "user"
      ? and(eq(retrievalRecords.userId, actor.userId), isNull(retrievalRecords.guestSessionId))
      : and(eq(retrievalRecords.guestSessionId, actor.guestSessionId), isNull(retrievalRecords.userId));
    const [record] = await db.select({ hits: retrievalRecords.hits }).from(retrievalRecords)
      .where(and(eq(retrievalRecords.id, retrievalRecordId), owner)).limit(1);
    return record?.hits ?? null;
  },
  async resolvePairs(pairs) {
    if (pairs.length === 0) return [];
    const rows = await db.select({
      itemId: knowledgeItems.id,
      sourceId: knowledgeSources.id,
      title: knowledgeItems.title,
      sourceName: knowledgeSources.name,
      sourceType: knowledgeSources.sourceType,
      summary: sql<string>`left(${knowledgeItems.searchableText}, 180)`,
      reviewedAt: knowledgeSources.reviewedAt,
      publicUrl: knowledgeSources.publicUrl,
    }).from(knowledgeItems)
      .innerJoin(knowledgeSources, eq(knowledgeItems.knowledgeSourceId, knowledgeSources.id))
      .where(inArray(knowledgeItems.id, pairs.map((pair) => pair.itemId)));
    const allow = new Set(pairs.map((pair) => `${pair.itemId}:${pair.sourceId}`));
    return rows.filter((row) => allow.has(`${row.itemId}:${row.sourceId}`));
  },
};

export async function resolveRunCitations(
  actor: CurrentActor,
  retrievalRecordId: string,
  pairs: CitationPair[],
  repository: CitationRepository = databaseCitationRepository,
) {
  const parsedInput = z.object({ retrievalRecordId: z.uuid(), pairs: citationPairsSchema }).strict().parse({ retrievalRecordId, pairs });
  const snapshot = await repository.getActorSnapshot(actor, parsedInput.retrievalRecordId);
  if (!snapshot) throw new Error("NOT_FOUND");
  const hits = z.array(snapshotHitSchema).max(100).parse(snapshot);
  const allow = new Set(hits.filter((hit) => hit.selected).map((hit) => `${hit.itemId}:${hit.sourceId}`));
  const seen = new Set<string>();
  const selectedPairs = parsedInput.pairs.filter((pair) => {
    const key = `${pair.itemId}:${pair.sourceId}`;
    if (!allow.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rows = z.array(citationViewSchema).parse(await repository.resolvePairs(selectedPairs));
  const rowsByPair = new Map(rows.map((row) => [`${row.itemId}:${row.sourceId}`, row]));
  return selectedPairs.flatMap((pair) => {
    const row = rowsByPair.get(`${pair.itemId}:${pair.sourceId}`);
    return row ? [row] : [];
  });
}
