import { describe, expect, test, vi } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { productConversionEventSchema, productEventSchema, recordProductEvent } from "./events";

const actor: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };

describe("privacy-safe analytics", () => {
  test.each([
    "positioning_confirmed",
    "tasks_saved",
    "review_actions_saved",
    "task_completed",
    "data_acquisition_completed",
  ])("allows the core conversion event %s", (eventName) => {
    expect(productConversionEventSchema.parse({
      eventName,
      flow: "creator_loop",
      entityVersion: 1,
      metadata: {},
    })).toEqual({ eventName, flow: "creator_loop", entityVersion: 1, metadata: {} });
  });

  test("allows a conversion event without an invented entity version", () => {
    expect(productConversionEventSchema.parse({
      eventName: "data_acquisition_completed",
      flow: "review",
      metadata: { metricCount: 3 },
    })).toEqual({
      eventName: "data_acquisition_completed",
      flow: "review",
      metadata: { metricCount: 3 },
    });
  });

  test("rejects private, nested, and unbounded conversion metadata", () => {
    const base = { eventName: "tasks_saved", flow: "creator_loop", entityVersion: 1 } as const;
    expect(() => productConversionEventSchema.parse({ ...base, metadata: { email: "a@example.com" } })).toThrow();
    expect(() => productConversionEventSchema.parse({ ...base, metadata: { context: { body: "完整正文" } } })).toThrow();
    expect(() => productConversionEventSchema.parse({ ...base, metadata: { label: "x".repeat(81) } })).toThrow();
  });

  test("allows only finite numeric conversion metadata", () => {
    const base = { eventName: "tasks_saved", flow: "creator_loop", entityVersion: 1 } as const;
    expect(productConversionEventSchema.parse({ ...base, metadata: { itemCount: 3 } }).metadata).toEqual({ itemCount: 3 });
    expect(() => productConversionEventSchema.parse({ ...base, metadata: { sourceMode: "manual" } })).toThrow();
    expect(() => productConversionEventSchema.parse({ ...base, metadata: { retried: false } })).toThrow();
    expect(() => productConversionEventSchema.parse({ ...base, metadata: { score: Number.POSITIVE_INFINITY } })).toThrow();
  });

  test("rejects full text and arbitrary properties", () => {
    expect(() => productEventSchema.parse({ name: "plan_generated", page: "creation", body: "完整正文" })).toThrow();
    expect(() => productEventSchema.parse({ name: "plan_generated", page: "/creation/private-id" })).toThrow();
  });

  test("records only allowlisted categorical and numeric values", async () => {
    const insert = vi.fn(async () => undefined);
    await recordProductEvent(actor, { name: "plan_generated", flow: "creation", page: "creation_plan", result: "success", numericProperties: { itemCount: 3 } }, { insert });
    expect(insert).toHaveBeenCalledWith(actor, expect.not.objectContaining({ body: expect.anything() }));
  });
});
