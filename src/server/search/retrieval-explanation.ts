import {
  normalizeRetrievalInput,
  type NormalizedRetrievalInput,
  RetrievalInput,
  type KnowledgeCandidate,
} from "./retrieve-knowledge";

export type RetrievalSignal = {
  kind: "base" | "knowledge_bonus" | "database_rank" | "exact_tag" | "substring" | "token";
  value?: string;
  contribution: number;
};

export type RetrievalRejection =
  | "SOURCE_NOT_APPROVED"
  | "SOURCE_NOT_PRODUCTION"
  | "SOURCE_DEMO"
  | "SOURCE_AI_SEND_NOT_ALLOWED"
  | "ITEM_NOT_APPROVED"
  | "ITEM_NOT_PRODUCTION"
  | "ITEM_DEMO"
  | "ITEM_DISABLED"
  | "OUTSIDE_VALIDITY"
  | "PLATFORM_MISMATCH"
  | "CONTENT_TYPE_MISMATCH"
  | "NO_DETERMINISTIC_MATCH";

export type RetrievalExplanation = {
  accepted: boolean;
  signals: RetrievalSignal[];
  reasons: RetrievalRejection[];
  totalScore: number;
};

export type ExplainedKnowledgeHit = {
  kind: KnowledgeCandidate["kind"];
  sourceName: string;
  title: string;
  excerpt: string;
  version: number;
  score: number;
  matchMode: "deterministic_text";
  signals: RetrievalSignal[];
};

export type AdminRetrievalResult = {
  hits: ExplainedKnowledgeHit[];
  reasonCounts: Partial<Record<RetrievalRejection, number>>;
  candidateCount: number;
  acceptedCandidateCount: number;
  excludedCandidateCount: number;
  inspectionLimit: number;
};

export interface AdminKnowledgeInspectionRepository {
  readonly limit: number;
  findInspectionCandidates(
    input: NormalizedRetrievalInput,
    now: Date,
  ): Promise<KnowledgeCandidate[]>;
}

function normalize(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function compact(value: string) {
  return normalize(value).replace(/\s+/gu, "");
}

function uniqueNormalized(values: readonly string[]) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function collectRejections(
  candidate: KnowledgeCandidate,
  input: NormalizedRetrievalInput,
  now: Date,
) {
  const reasons: RetrievalRejection[] = [];
  if (candidate.sourceReviewStatus !== "approved") reasons.push("SOURCE_NOT_APPROVED");
  if (candidate.sourceRetrievalScope !== "production") reasons.push("SOURCE_NOT_PRODUCTION");
  if (candidate.sourceIsDemo) reasons.push("SOURCE_DEMO");
  if (!candidate.sourceAllowAiSend) reasons.push("SOURCE_AI_SEND_NOT_ALLOWED");
  if (candidate.itemReviewStatus !== "approved") reasons.push("ITEM_NOT_APPROVED");
  if (candidate.itemRetrievalScope !== "production") reasons.push("ITEM_NOT_PRODUCTION");
  if (candidate.itemIsDemo) reasons.push("ITEM_DEMO");
  if (!candidate.enabled) reasons.push("ITEM_DISABLED");
  if ((candidate.validFrom && candidate.validFrom > now) || (candidate.validUntil && candidate.validUntil < now)) {
    reasons.push("OUTSIDE_VALIDITY");
  }

  const platform = normalize(candidate.platform ?? "");
  if (platform !== input.platform && platform !== "all") {
    reasons.push("PLATFORM_MISMATCH");
  }
  const contentType = normalize(candidate.contentType ?? "");
  if (candidate.kind === "knowledge" && contentType !== input.contentType && contentType !== "general" && contentType !== "all") {
    reasons.push("CONTENT_TYPE_MISMATCH");
  }

  const tags = new Set(uniqueNormalized(candidate.tags));
  const document = `${normalize(candidate.title)} ${normalize(candidate.body)}`;
  const compactDocument = compact(document);
  const matches = candidate.kind === "rule" ||
    (input.tags.length === 0 && input.keywords.length === 0) ||
    input.tags.some((tag) => tags.has(tag)) ||
    input.keywords.some((keyword) => document.includes(keyword) || compactDocument.includes(compact(keyword)));
  if (!matches) reasons.push("NO_DETERMINISTIC_MATCH");
  return reasons;
}

function scoreSignals(candidate: KnowledgeCandidate, input: NormalizedRetrievalInput) {
  const signals: RetrievalSignal[] = [{ kind: "base", contribution: 20 }];
  if (candidate.kind === "knowledge") signals.push({ kind: "knowledge_bonus", contribution: 10 });
  const databaseRank = Number(candidate.databaseRank ?? 0) * 100;
  if (databaseRank) signals.push({ kind: "database_rank", contribution: databaseRank });

  const tags = new Set(uniqueNormalized(candidate.tags));
  for (const tag of input.tags) {
    if (tags.has(tag)) signals.push({ kind: "exact_tag", value: tag, contribution: 5 });
  }

  const document = `${normalize(candidate.title)} ${normalize(candidate.body)}`;
  const compactDocument = compact(document);
  const tokens = new Set(document.split(/\s+/u).filter(Boolean));
  for (const keyword of input.keywords) {
    if (document.includes(keyword) || compactDocument.includes(compact(keyword))) {
      signals.push({ kind: "substring", value: keyword, contribution: 3 });
    }
    for (const token of keyword.split(/\s+/u)) {
      if (tokens.has(token)) signals.push({ kind: "token", value: token, contribution: 1 });
    }
  }
  return signals;
}

export function explainCandidate(
  candidate: KnowledgeCandidate,
  input: NormalizedRetrievalInput,
  now = new Date(),
): RetrievalExplanation {
  const reasons = collectRejections(candidate, input, now);
  const signals = reasons.length === 0 ? scoreSignals(candidate, input) : [];
  return {
    accepted: reasons.length === 0,
    reasons,
    signals,
    totalScore: signals.reduce((sum, signal) => sum + signal.contribution, 0),
  };
}

export async function explainKnowledgeRetrieval(
  input: RetrievalInput,
  repository: AdminKnowledgeInspectionRepository,
  now = new Date(),
): Promise<AdminRetrievalResult> {
  const normalized = normalizeRetrievalInput(input);
  const candidates = await repository.findInspectionCandidates(normalized, now);
  const reasonCounts: Partial<Record<RetrievalRejection, number>> = {};
  let excludedCandidateCount = 0;
  const accepted = candidates.flatMap((candidate) => {
    const explanation = explainCandidate(candidate, normalized, now);
    if (!explanation.accepted) {
      excludedCandidateCount += 1;
      for (const reason of explanation.reasons) {
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
      return [];
    }
    return [{ candidate, explanation }];
  }).sort((left, right) =>
    right.explanation.totalScore - left.explanation.totalScore ||
    left.candidate.id.localeCompare(right.candidate.id),
  );

  const sourceCounts = new Map<string, number>();
  const hits: ExplainedKnowledgeHit[] = [];
  for (const { candidate, explanation } of accepted) {
    const count = sourceCounts.get(candidate.sourceId) ?? 0;
    if (count >= 3) continue;
    hits.push({
      kind: candidate.kind,
      sourceName: candidate.sourceName,
      title: candidate.title,
      excerpt: candidate.body.slice(0, 360),
      version: candidate.version,
      score: explanation.totalScore,
      matchMode: "deterministic_text",
      signals: explanation.signals,
    });
    sourceCounts.set(candidate.sourceId, count + 1);
    if (hits.length === 8) break;
  }
  return {
    hits,
    reasonCounts,
    candidateCount: candidates.length,
    acceptedCandidateCount: accepted.length,
    excludedCandidateCount,
    inspectionLimit: repository.limit,
  };
}
