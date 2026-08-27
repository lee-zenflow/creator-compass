import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const viewPath = "src/features/workspace/platform-accounts-view.tsx";

describe("platform account presentation contract", () => {
  test("has a focused view component for manual account labels", () => {
    expect(existsSync(viewPath)).toBe(true);
    if (!existsSync(viewPath)) return;
    const source = readFileSync(viewPath, "utf8");
    expect(source).toContain("export function PlatformAccountsView");
  });
});
