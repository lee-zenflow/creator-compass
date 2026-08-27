import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const page = readFileSync(resolve(process.cwd(), "src/app/(product)/reports/page.tsx"), "utf8");

describe("report history page contract", () => {
  test("keeps archived detail navigation and URL type filters restorable", () => {
    expect(page).toContain("backHref={reportListHref(archivedView, activeType)}");
    expect(page).toContain("function reportListHref(");
    expect(page).toContain("query.type");
    expect(page).toContain("activeType={activeType}");
  });

  test("shows the root update timestamp and AI citation count", () => {
    expect(page).toContain("detail.root.updatedAt");
    expect(page).toContain("引用 {version.citationMode === \"legacy\" ? version.legacySources.length : version.citations.length} 条");
  });
});
