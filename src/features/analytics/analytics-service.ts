import type { CurrentActor } from "@/features/identity/current-actor";
import { db } from "@/server/db/client";
import { productEvents } from "@/server/db/schema";
import {
  containsPrivateAnalyticsKey,
  productConversionEventSchema,
  type ProductEvent,
  type ProductEventInput,
} from "./events";

type AnalyticsOwner =
  | { userId: string; guestSessionId: null }
  | { userId: null; guestSessionId: string };

export type AnalyticsRecord = AnalyticsOwner & ProductEvent;

export interface AnalyticsRepository {
  insert(record: AnalyticsRecord): Promise<unknown>;
}

export function logSafeAnalyticsFailure(error: unknown) {
  void error;
  console.error("PRODUCT_ANALYTICS_WRITE_FAILED");
}

const databaseAnalyticsRepository: AnalyticsRepository = {
  async insert(record) {
    const { entityVersion, metadata, ...event } = record;
    const [inserted] = await db.insert(productEvents).values({
      ...event,
      numericProperties: {
        ...(entityVersion === undefined ? {} : { entityVersion }),
        ...metadata,
      },
    }).returning({ id: productEvents.id });
    if (!inserted) throw new Error("ANALYTICS_INSERT_FAILED");
    return inserted;
  },
};

function ownerFromActor(actor: CurrentActor): AnalyticsOwner {
  return actor.kind === "user"
    ? { userId: actor.userId, guestSessionId: null }
    : { userId: null, guestSessionId: actor.guestSessionId };
}

export async function trackProductEvent(
  actor: CurrentActor,
  input: ProductEventInput,
  repository: AnalyticsRepository = databaseAnalyticsRepository,
) {
  if (
    typeof input === "object"
    && input !== null
    && "metadata" in input
    && typeof input.metadata === "object"
    && input.metadata !== null
    && !Array.isArray(input.metadata)
    && containsPrivateAnalyticsKey(input.metadata as Record<string, unknown>)
  ) {
    throw new Error("PRIVATE_ANALYTICS_FIELD");
  }
  const event = productConversionEventSchema.parse(input);
  return repository.insert({ ...ownerFromActor(actor), ...event });
}
