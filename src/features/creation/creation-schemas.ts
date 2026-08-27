import { createHash } from "node:crypto";

import { z } from "zod";

const shortText = z.string().trim().min(1).max(240);
const paragraph = z.string().trim().min(1).max(20_000);
const list = z.array(shortText).max(20);

export const creationContentTypeSchema = z.enum(["article", "video", "copy"]);
export const creationRequestSchema = z.object({
  contentType: creationContentTypeSchema,
  platform: z.string().trim().min(1).max(80),
  goal: z.string().trim().min(1).max(2_000),
  requirements: z.string().trim().max(4_000).nullable().optional(),
  availableMinutes: z.number().int().min(15).max(10_080).nullable().optional(),
}).strict();

export const creationCitationSchema = z.object({
  itemId: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(120),
}).strict();

const rawTaskSchema = z.object({
  title: shortText,
  reason: z.string().trim().min(1).max(4_000),
  steps: z.array(shortText).min(1).max(8),
  completionCriteria: z.string().trim().min(1).max(4_000),
  estimatedMinutes: z.number().int().min(5).max(1_440),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
}).strict();

export const contentPlanTaskSchema = rawTaskSchema.extend({
  id: z.uuid(),
  plannedDate: z.iso.date(),
}).strict();

const common = {
  tasks: z.array(rawTaskSchema).min(1).max(12),
  citations: z.array(creationCitationSchema).max(8),
};

export const contentPlanOutputSchemas = {
  article: z.object({
    contentType: z.literal("article"),
    titleSuggestions: z.array(shortText).min(1).max(8),
    outline: z.array(shortText).min(1).max(20),
    body: paragraph,
    imageSuggestions: list,
    riskNotes: list,
    ...common,
  }).strict(),
  video: z.object({
    contentType: z.literal("video"),
    hooks: z.array(shortText).min(1).max(8),
    storyboard: z.array(shortText).min(1).max(30),
    voiceover: paragraph,
    shootingSteps: list,
    riskNotes: list,
    ...common,
  }).strict(),
  copy: z.object({
    contentType: z.literal("copy"),
    titleSuggestions: z.array(shortText).min(1).max(8),
    body: paragraph,
    publishingGuide: list,
    riskNotes: list,
    ...common,
  }).strict(),
} as const;

export const contentPlanRawOutputSchema = z.discriminatedUnion("contentType", [
  contentPlanOutputSchemas.article,
  contentPlanOutputSchemas.video,
  contentPlanOutputSchemas.copy,
]);

const normalizedCommon = {
  tasks: z.array(contentPlanTaskSchema).min(1).max(12),
  citations: z.array(creationCitationSchema).max(8),
};

export const contentPlanOutputSchema = z.discriminatedUnion("contentType", [
  contentPlanOutputSchemas.article.omit({ tasks: true, citations: true }).extend(normalizedCommon).strict(),
  contentPlanOutputSchemas.video.omit({ tasks: true, citations: true }).extend(normalizedCommon).strict(),
  contentPlanOutputSchemas.copy.omit({ tasks: true, citations: true }).extend(normalizedCommon).strict(),
]);

function stableUuid(seed: string) {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function plannedDate(baseDate: Date, index: number, priority: 1 | 2 | 3) {
  const offset = priority === 1 ? Math.min(index, 2) : priority === 2 ? 3 + index : 7 + index;
  const date = new Date(baseDate.getTime() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function normalizeContentPlanOutput(
  input: z.input<typeof contentPlanRawOutputSchema>,
  aiRunId: string,
  baseDate = new Date(),
): ContentPlanOutput {
  const raw = contentPlanRawOutputSchema.parse(input);
  const runId = z.uuid().parse(aiRunId);
  return contentPlanOutputSchema.parse({
    ...raw,
    tasks: raw.tasks.map((task, index) => ({
      ...task,
      id: stableUuid(`${runId}:creation-task:${index}`),
      plannedDate: plannedDate(baseDate, index, task.priority),
    })),
  });
}

export function assertContentPlanCitationsAllowed(
  output: ContentPlanOutput,
  allowed: Array<{ itemId: string; sourceId: string }>,
) {
  const pairs = new Set(allowed.map((hit) => `${hit.itemId}\u0000${hit.sourceId}`));
  for (const citation of output.citations) {
    if (!pairs.has(`${citation.itemId}\u0000${citation.sourceId}`)) throw new Error("INVALID_CITATION");
  }
}

export type CreationContentType = z.infer<typeof creationContentTypeSchema>;
export type CreationRequest = z.input<typeof creationRequestSchema>;
export type ContentPlanRawOutput = z.infer<typeof contentPlanRawOutputSchema>;
export type ContentPlanOutput = z.infer<typeof contentPlanOutputSchema>;
