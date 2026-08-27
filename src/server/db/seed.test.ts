import { describe, expect, test } from "vitest";

import { isProductionRetrievableKnowledge } from "./schema";
import { buildDevelopmentSeed } from "./seed";

describe("development database seed", () => {
  test("keeps the production case library empty until real sources are reviewed", () => {
    const seed = buildDevelopmentSeed("Owner@Example.com");

    expect(seed.knowledgeItems.filter(isProductionRetrievableKnowledge)).toEqual([]);
    expect(seed.knowledgeItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authority: "internal_example",
          isDemo: true,
          retrievalScope: "development_only",
        }),
      ]),
    );
  });

  test("leaves every external URL pending review", () => {
    const seed = buildDevelopmentSeed("");

    for (const source of seed.knowledgeSources.filter((item) => item.publicUrl)) {
      expect(source.reviewStatus).toBe("pending");
      expect(source.retrievalScope).toBe("development_only");
    }
  });

  test("labels product guidance as internal rather than official platform policy", () => {
    const seed = buildDevelopmentSeed("");

    expect(seed.platformRules.length).toBeGreaterThan(0);
    for (const rule of seed.platformRules) {
      expect(rule.authority).toBe("internal_product_rule");
      expect(rule.officialPlatformRule).toBe(false);
    }
  });

  test("normalizes only configured admin emails and seeds versioned prompts", () => {
    const seed = buildDevelopmentSeed(" Owner@Example.com,second@example.com ");

    expect(seed.adminEmails).toEqual(["owner@example.com", "second@example.com"]);
    expect(seed.promptVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskType: "profile_extract", version: 1 }),
        expect.objectContaining({ taskType: "review_report", version: 1 }),
      ]),
    );
  });
});
