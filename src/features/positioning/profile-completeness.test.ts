import { describe, expect, test } from "vitest";

import {
  PROFILE_DIMENSIONS,
  assertReportAllowed,
  calculateProfileCompleteness,
  type CreatorProfileDraft,
} from "./profile-completeness";

const profileFromScores = (scores: Array<0 | 50 | 100>) =>
  Object.fromEntries(
    PROFILE_DIMENSIONS.map((key, index) => [
      key,
      { score: scores[index], value: `evidence-${index}`, evidenceMessageIds: [] },
    ]),
  ) as unknown as CreatorProfileDraft;

describe("profile completeness", () => {
  test("uses the fixed eight-dimension order", () => {
    expect(PROFILE_DIMENSIONS).toEqual([
      "interestsExperience",
      "skills",
      "resources",
      "availableTime",
      "creationGoal",
      "platformPreference",
      "sustainableSources",
      "constraints",
    ]);
  });

  test("uses eight equal dimensions and unlocks at eighty percent", () => {
    const result = calculateProfileCompleteness(
      profileFromScores([100, 100, 100, 100, 100, 100, 50, 0]),
    );
    expect(result.percentage).toBe(81);
    expect(result.canGenerate).toBe(true);
  });

  test("rejects scores outside zero, fifty, and one hundred", () => {
    const profile = profileFromScores([100, 100, 100, 100, 100, 100, 50, 0]);
    profile.constraints.score = 75 as 0;
    expect(() => calculateProfileCompleteness(profile)).toThrow("INVALID_PROFILE_SCORE");
  });

  test("prevents a formal report below eighty percent", () => {
    expect(() => assertReportAllowed(79)).toThrow("PROFILE_INCOMPLETE");
    expect(() => assertReportAllowed(80)).not.toThrow();
  });
});
