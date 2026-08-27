import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db } from "@/server/db/client";
import { productEvents } from "@/server/db/schema";

const forbiddenAnalyticsKeyParts = [
  "email",
  "token",
  "secret",
  "transcript",
  "ocrrawtext",
  "body",
  "fullcontent",
  "apikey",
];

export function containsPrivateAnalyticsKey(metadata: Record<string, unknown>) {
  return Object.keys(metadata).some((key) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return forbiddenAnalyticsKeyParts.some((part) => normalized.includes(part));
  });
}

export const productConversionEventSchema = z.object({
  eventName: z.enum([
    "positioning_confirmed",
    "tasks_saved",
    "review_actions_saved",
    "task_completed",
    "data_acquisition_completed",
  ]),
  flow: z.enum(["positioning", "creation", "review", "task", "creator_loop"]),
  entityVersion: z.number().int().positive().optional(),
  metadata: z.record(
    z.string(),
    z.number().finite(),
  ).default({}),
}).strict().superRefine((event, context) => {
  if (containsPrivateAnalyticsKey(event.metadata)) {
    context.addIssue({ code: "custom", message: "PRIVATE_ANALYTICS_FIELD", path: ["metadata"] });
  }
});

export type ProductEventInput = z.input<typeof productConversionEventSchema>;
export type ProductEvent = z.output<typeof productConversionEventSchema>;

export const productEventSchema = z.object({
  name: z.enum(["positioning_started", "positioning_confirmed", "plan_generated", "review_generated", "tasks_committed"]),
  flow: z.enum(["positioning", "creation", "review", "tasks"]).optional(),
  page: z.enum(["positioning_interview", "positioning_report", "creation_request", "creation_plan", "review_confirm", "review_report", "task_preview"]).optional(),
  result: z.enum(["success", "failed", "cancelled"]).optional(),
  durationBucket: z.enum(["under_10s", "10_30s", "30_120s", "over_120s"]).optional(),
  errorType: z.enum(["not_configured", "rate_limited", "timeout", "invalid_output", "upstream", "validation"]).optional(),
  numericProperties: z.object({ itemCount: z.number().int().min(0).max(100).optional(), stepCount: z.number().int().min(0).max(100).optional(), completeness: z.number().int().min(0).max(100).optional() }).strict().optional(),
}).strict();

export interface ProductEventRepository {
  insert(actor: CurrentActor, event: z.output<typeof productEventSchema>): Promise<void>;
}

const databaseProductEventRepository: ProductEventRepository = {
  async insert(actor, event) {
    await db.insert(productEvents).values({
      ...(actor.kind === "user" ? { userId: actor.userId, guestSessionId: null } : { userId: null, guestSessionId: actor.guestSessionId }),
      eventName: event.name, flow: event.flow ?? null, page: event.page ?? null,
      result: event.result ?? null, durationBucket: event.durationBucket ?? null,
      errorType: event.errorType ?? null, numericProperties: event.numericProperties ?? {},
    });
  },
};

export function recordProductEvent(actor: CurrentActor, event: z.input<typeof productEventSchema>, repository = databaseProductEventRepository) {
  return repository.insert(actor, productEventSchema.parse(event));
}
