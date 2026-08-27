import { createHash } from "node:crypto";

import { z } from "zod";

const shortText = z.string().trim().min(1).max(240);
const paragraph = z.string().trim().min(1).max(4_000);
export const reviewCitationSchema = z.object({ itemId: z.uuid(), sourceId: z.uuid() }).strict();
const citations = z.array(reviewCitationSchema).max(8);

const reviewActionRawSchema = z.object({
  title: shortText,
  reason: paragraph,
  steps: z.array(shortText).min(1).max(8),
  completionCriteria: paragraph,
  estimatedMinutes: z.number().int().min(5).max(1_440),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
}).strict();

export const reviewActionSchema = reviewActionRawSchema.extend({
  id: z.uuid(),
  plannedDate: z.iso.date(),
}).strict();

export const reviewReportRawOutputSchema = z.object({
  dataSummary: z.record(z.string().max(80), z.union([z.string().max(2_000), z.number()])),
  retained: z.array(paragraph).max(20),
  problems: z.array(paragraph).max(20),
  causes: z.array(paragraph).max(20),
  actions: z.array(reviewActionRawSchema).min(1).max(12),
  citations,
}).strict();

export const reviewReportOutputSchema = reviewReportRawOutputSchema.omit({ actions: true }).extend({
  actions: z.array(reviewActionSchema).min(1).max(12),
}).strict();

function stableUuid(seed: string) {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function plannedDate(baseDate: Date, index: number, priority: 1 | 2 | 3) {
  const offset = priority === 1 ? 1 + Math.min(index, 2) : priority === 2 ? 4 + index : 8 + index;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(baseDate.getTime() + offset * 86_400_000));
}

export function normalizeReviewReportOutput(
  input: z.input<typeof reviewReportRawOutputSchema>,
  aiRunId: string,
  baseDate: Date,
) {
  const raw = reviewReportRawOutputSchema.parse(input);
  const runId = z.uuid().parse(aiRunId);
  return reviewReportOutputSchema.parse({
    ...raw,
    actions: raw.actions.map((action, index) => ({
      ...action,
      id: stableUuid(`${runId}:review-task:${index}`),
      plannedDate: plannedDate(baseDate, index, action.priority),
    })),
  });
}

export function assertReviewCitationsAllowed(
  output: z.input<typeof reviewReportRawOutputSchema>,
  allowedPairs: Array<z.infer<typeof reviewCitationSchema>>,
) {
  const allowed = new Set(allowedPairs.map((pair) => `${pair.itemId}\u0000${pair.sourceId}`));
  for (const citation of output.citations) {
    if (!allowed.has(`${citation.itemId}\u0000${citation.sourceId}`)) throw new Error("INVALID_CITATION");
  }
}

export type ReviewReportOutput = z.infer<typeof reviewReportOutputSchema>;
