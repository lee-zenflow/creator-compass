import { describe, expect, test } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import { assertActorObjectKey, buildActorObjectKey } from "./storage";

const owner: CurrentActor = { kind: "user", userId: "10000000-0000-4000-8000-000000000001", role: "user" };
const other: CurrentActor = { kind: "user", userId: "20000000-0000-4000-8000-000000000002", role: "user" };

describe("actor-scoped object keys", () => {
  test("generates normalized keys under the current actor prefix", () => {
    expect(buildActorObjectKey(owner, "我的 截图.png", "fixed-id")).toBe("private/user/10000000-0000-4000-8000-000000000001/fixed-id-_.png");
  });

  test("rejects access to another actor's key", () => {
    const key = buildActorObjectKey(owner, "review.png", "fixed-id");
    expect(() => assertActorObjectKey(other, key)).toThrow("FORBIDDEN");
  });

  test.each([
    `private/user/${owner.userId}/../secret.txt`,
    `private/user/${owner.userId}/folder\\secret.txt`,
    `private/user/${owner.userId}/`,
  ])("rejects an unsafe object key: %s", (key) => {
    expect(() => assertActorObjectKey(owner, key)).toThrow("FORBIDDEN");
  });
});
