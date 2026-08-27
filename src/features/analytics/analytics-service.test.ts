import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  logSafeAnalyticsFailure,
  trackProductEvent,
  type AnalyticsRepository,
} from "./analytics-service";

const actor: CurrentActor = {
  kind: "user",
  userId: "10000000-0000-4000-8000-000000000001",
  role: "user",
};

function repository() {
  const insert = vi.fn<AnalyticsRepository["insert"]>(async (record) => record);
  return { insert };
}

describe("trackProductEvent", () => {
  test.each([
    "positioning_confirmed",
    "tasks_saved",
    "review_actions_saved",
    "task_completed",
    "data_acquisition_completed",
  ] as const)("accepts %s", async (eventName) => {
    await expect(trackProductEvent(actor, {
      eventName,
      flow: "creator_loop",
      entityVersion: 1,
      metadata: {},
    }, repository())).resolves.toBeDefined();
  });

  test.each(["email", "user_email", "token", "access-token", "transcript", "ocr_raw_text", "body", "fullContent", "api_key"])(
    "rejects private analytics key %s",
    async (privateKey) => {
      await expect(trackProductEvent(actor, {
        eventName: "tasks_saved",
        flow: "creator_loop",
        entityVersion: 1,
        metadata: { [privateKey]: "private" },
      } as never, repository())).rejects.toThrow("PRIVATE_ANALYTICS_FIELD");
    },
  );

  test("derives ownership from the server actor and keeps only validated event properties", async () => {
    const target = repository();
    await trackProductEvent(actor, {
      eventName: "tasks_saved",
      flow: "creator_loop",
      entityVersion: 2,
      metadata: { itemCount: 3 },
    }, target);

    expect(target.insert).toHaveBeenCalledWith({
      userId: actor.userId,
      guestSessionId: null,
      eventName: "tasks_saved",
      flow: "creator_loop",
      entityVersion: 2,
      metadata: { itemCount: 3 },
    });
  });

  test("does not persist entityVersion when the event has no real business version", async () => {
    const target = repository();

    await trackProductEvent(actor, {
      eventName: "data_acquisition_completed",
      flow: "review",
      metadata: { metricCount: 3 },
    }, target);

    expect(target.insert).toHaveBeenCalledWith({
      userId: actor.userId,
      guestSessionId: null,
      eventName: "data_acquisition_completed",
      flow: "review",
      metadata: { metricCount: 3 },
    });
  });

  test("does not accept a form supplied user id", async () => {
    await expect(trackProductEvent(actor, {
      eventName: "tasks_saved",
      flow: "creator_loop",
      entityVersion: 1,
      metadata: {},
      userId: "90000000-0000-4000-8000-000000000009",
    } as never, repository())).rejects.toThrow();
  });
});

describe("logSafeAnalyticsFailure", () => {
  test("logs only a fixed error code without the original failure detail", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logSafeAnalyticsFailure(new Error("private-input-must-not-leak"));

    expect(consoleError).toHaveBeenCalledWith("PRODUCT_ANALYTICS_WRITE_FAILED");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private-input-must-not-leak");
    consoleError.mockRestore();
  });
});
