export const PROFILE_DIMENSIONS = [
  "interestsExperience",
  "skills",
  "resources",
  "availableTime",
  "creationGoal",
  "platformPreference",
  "sustainableSources",
  "constraints",
] as const;

export type ProfileDimensionKey = (typeof PROFILE_DIMENSIONS)[number];
export type ProfileDimensionScore = 0 | 50 | 100;
export type ProfileDimension = {
  score: ProfileDimensionScore;
  value: string;
  evidenceMessageIds: string[];
};
export type CreatorProfileDraft = Record<ProfileDimensionKey, ProfileDimension>;
export type DimensionStatus = ProfileDimension & { key: ProfileDimensionKey };

export function calculateProfileCompleteness(profile: CreatorProfileDraft) {
  const dimensions = PROFILE_DIMENSIONS.map((key) => {
    const value = profile[key];
    if (!value || !([0, 50, 100] as number[]).includes(value.score)) {
      throw new Error("INVALID_PROFILE_SCORE");
    }
    return { key, ...value };
  });
  const percentage = Math.round(
    dimensions.reduce((total, dimension) => total + dimension.score, 0) /
      PROFILE_DIMENSIONS.length,
  );
  return { percentage, canGenerate: percentage >= 80, dimensions };
}

export function assertReportAllowed(percentage: number) {
  if (!Number.isInteger(percentage) || percentage < 80 || percentage > 100) {
    throw new Error("PROFILE_INCOMPLETE");
  }
}

export function emptyProfileDraft(): CreatorProfileDraft {
  return Object.fromEntries(
    PROFILE_DIMENSIONS.map((key) => [key, { score: 0, value: "", evidenceMessageIds: [] }]),
  ) as unknown as CreatorProfileDraft;
}
