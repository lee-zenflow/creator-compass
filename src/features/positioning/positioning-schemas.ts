import { createHash } from "node:crypto";

import { z } from "zod";

import { PROFILE_DIMENSIONS } from "./profile-completeness";

const boundedText = z.string().trim().min(1).max(4_000);
const shortText = z.string().trim().min(1).max(240);
const evidenceId = z.uuid();

export const profileDimensionSchema = z
  .object({
    score: z.union([z.literal(0), z.literal(50), z.literal(100)]),
    value: z.string().trim().max(2_000),
    evidenceMessageIds: z.array(evidenceId).max(20),
  })
  .strict()
  .superRefine((dimension, context) => {
    if (dimension.score > 0 && (!dimension.value || dimension.evidenceMessageIds.length === 0)) {
      context.addIssue({ code: "custom", message: "Scored profile dimensions require user evidence." });
    }
    if (dimension.score === 0 && dimension.evidenceMessageIds.length > 0) {
      context.addIssue({ code: "custom", message: "Unscored profile dimensions cannot cite evidence." });
    }
  });

export const profileDimensionsSchema = z
  .object(Object.fromEntries(PROFILE_DIMENSIONS.map((key) => [key, profileDimensionSchema])) as {
    [K in (typeof PROFILE_DIMENSIONS)[number]]: typeof profileDimensionSchema;
  })
  .strict();

export const profileExtractOutputSchema = z
  .object({
    profileDimensions: profileDimensionsSchema,
    nextQuestion: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const positioningCitationSchema = z
  .object({ itemId: z.string().trim().min(1).max(120), sourceId: z.string().trim().min(1).max(120) })
  .strict();

export const positioningTaskRawSchema = z
  .object({
    title: shortText,
    reason: boundedText,
    steps: z.array(shortText).min(1).max(8),
    completionCriteria: boundedText,
    estimatedMinutes: z.number().int().min(5).max(1_440),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

export const positioningTaskSchema = positioningTaskRawSchema.extend({
  id: z.uuid(),
  plannedDate: z.iso.date(),
}).strict();

export const positioningCandidateRawSchema = z
  .object({
    name: shortText,
    audience: boundedText,
    direction: boundedText,
    contentPillars: z.array(shortText).length(3),
    matchExplanation: boundedText,
    risks: z.array(boundedText).max(8),
    citations: z.array(positioningCitationSchema).max(5),
    initialTasks: z.array(positioningTaskRawSchema).min(3).max(6),
  })
  .strict();

export const positioningCandidateSchema = positioningCandidateRawSchema.extend({
  id: z.uuid(),
  initialTasks: z.array(positioningTaskSchema).min(3).max(6),
}).strict();

export const positioningReportRawOutputSchema = z
  .object({ candidates: z.array(positioningCandidateRawSchema).length(3) })
  .strict();

export const positioningReportOutputSchema = z
  .object({ candidates: z.array(positioningCandidateSchema).length(3) })
  .strict()
  .superRefine((value, context) => {
    const candidateIds = value.candidates.map((candidate) => candidate.id);
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({ code: "custom", message: "Candidate ids must be unique." });
    }
    for (const [candidateIndex, candidate] of value.candidates.entries()) {
      const taskIds = candidate.initialTasks.map((task) => task.id);
      if (new Set(taskIds).size !== taskIds.length) {
        context.addIssue({
          code: "custom",
          message: "Task ids must be unique within a candidate.",
          path: ["candidates", candidateIndex, "initialTasks"],
        });
      }
    }
  });

function stableUuid(seed: string) {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function plannedDateForTask(baseDate: Date, taskIndex: number, priority: 1 | 2 | 3) {
  const offsetDays = priority === 1 ? Math.min(taskIndex, 2) : priority === 2 ? 3 + taskIndex : 7 + taskIndex;
  const scheduled = new Date(baseDate.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(scheduled);
}

export function normalizePositioningReportOutput(
  input: z.input<typeof positioningReportRawOutputSchema>,
  aiRunId: string,
  baseDate = new Date(),
): PositioningReportOutput {
  const raw = positioningReportRawOutputSchema.parse(input);
  const runSeed = z.uuid().parse(aiRunId);
  return positioningReportOutputSchema.parse({
    candidates: raw.candidates.map((candidate, candidateIndex) => ({
      ...candidate,
      id: stableUuid(`${runSeed}:candidate:${candidateIndex}`),
      initialTasks: candidate.initialTasks.map((task, taskIndex) => ({
        ...task,
        id: stableUuid(`${runSeed}:candidate:${candidateIndex}:task:${taskIndex}`),
        plannedDate: plannedDateForTask(baseDate, taskIndex, task.priority),
      })),
    })),
  });
}

export type ProfileExtractOutput = z.infer<typeof profileExtractOutputSchema>;
export type PositioningReportRawOutput = z.infer<typeof positioningReportRawOutputSchema>;
export type PositioningTask = z.infer<typeof positioningTaskSchema>;
export type PositioningCandidate = z.infer<typeof positioningCandidateSchema>;
export type PositioningReportOutput = z.infer<typeof positioningReportOutputSchema>;

export function assertCitationsAllowed(
  report: PositioningReportOutput,
  allowedHits: Array<{ itemId: string; sourceId: string }>,
) {
  const allowlist = new Set(allowedHits.map((hit) => `${hit.itemId}\u0000${hit.sourceId}`));
  for (const candidate of report.candidates) {
    for (const citation of candidate.citations) {
      if (!allowlist.has(`${citation.itemId}\u0000${citation.sourceId}`)) {
        throw new Error("INVALID_CITATION");
      }
    }
  }
}
