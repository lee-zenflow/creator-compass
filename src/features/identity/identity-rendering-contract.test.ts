import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("local identity rendering contract", () => {
  test.each([
    "src/app/page.tsx",
    "src/app/(auth)/setup/page.tsx",
    "src/app/(auth)/login/page.tsx",
    "src/app/(auth)/recovery/page.tsx",
  ])("keeps database-backed identity page %s dynamic", (path) => {
    expect(readFileSync(path, "utf8")).toContain('export const dynamic = "force-dynamic"');
  });
});
