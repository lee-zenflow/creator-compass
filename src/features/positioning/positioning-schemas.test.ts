import { describe, expect, test } from "vitest";

import {
  normalizePositioningReportOutput,
  positioningReportRawOutputSchema,
  positioningReportOutputSchema,
  profileExtractOutputSchema,
} from "./positioning-schemas";

const dimension = (score: 0 | 50 | 100) => ({
  score,
  value: score === 0 ? "" : "sample",
  evidenceMessageIds: score === 0 ? [] : ["00000000-0000-4000-8000-000000000001"],
});

describe("positioning AI contracts", () => {
  test("requires all eight scored dimensions and no unknown keys", () => {
    const output = {
      profileDimensions: {
        interestsExperience: dimension(100),
        skills: dimension(50),
        resources: dimension(0),
        availableTime: dimension(100),
        creationGoal: dimension(100),
        platformPreference: dimension(50),
        sustainableSources: dimension(0),
        constraints: dimension(50),
      },
      nextQuestion: "What can you sustain weekly?",
    };
    expect(profileExtractOutputSchema.parse(output)).toEqual(output);
    expect(() =>
      profileExtractOutputSchema.parse({
        ...output,
        profileDimensions: { ...output.profileDimensions, extra: dimension(100) },
      }),
    ).toThrow();
    expect(() => profileExtractOutputSchema.parse({
      ...output,
      profileDimensions: {
        ...output.profileDimensions,
        skills: { score: 100, value: "invented", evidenceMessageIds: [] },
      },
    })).toThrow(/evidence/i);
  });

  test("accepts model output without trusted ids and assigns stable server ids", () => {
    const candidate = {
      name: "Focused maker",
      audience: "Independent creators",
      direction: "Practical creator workflow",
      contentPillars: ["Positioning", "Production", "Review"],
      matchExplanation: "Matches the evidence supplied in the interview.",
      risks: ["Time is constrained"],
      citations: [{ itemId: "item-1", sourceId: "source-1" }],
      initialTasks: [
        {
          title: "Draft one topic",
          reason: "Validate the direction",
          steps: ["Write the outline"],
          completionCriteria: "One publishable outline is saved.",
          estimatedMinutes: 30,
          priority: 1,
        },
        {
          title: "Publish a test",
          reason: "Collect evidence",
          steps: ["Publish"],
          completionCriteria: "The test is publicly available.",
          estimatedMinutes: 45,
          priority: 2,
        },
        {
          title: "Review response",
          reason: "Decide what to keep",
          steps: ["Record findings"],
          completionCriteria: "Three findings are recorded.",
          estimatedMinutes: 20,
          priority: 2,
        },
      ],
    };
    const raw = {
      candidates: [
        candidate,
        { ...candidate, name: "Second" },
        { ...candidate, name: "Third" },
      ],
    };

    const parsedRaw = positioningReportRawOutputSchema.parse(raw);
    expect(parsedRaw).toEqual(raw);
    const baseDate = new Date("2026-08-09T00:00:00+08:00");
    const first = normalizePositioningReportOutput(parsedRaw, "00000000-0000-4000-8000-000000000099", baseDate);
    const retry = normalizePositioningReportOutput(parsedRaw, "00000000-0000-4000-8000-000000000099", baseDate);
    const otherRun = normalizePositioningReportOutput(parsedRaw, "00000000-0000-4000-8000-000000000100", baseDate);

    expect(first).toEqual(retry);
    expect(first).not.toEqual(otherRun);
    expect(first.candidates).toHaveLength(3);
    expect(first.candidates.every((item) => /^[0-9a-f-]{36}$/.test(item.id))).toBe(true);
    expect(first.candidates.flatMap((item) => item.initialTasks).every((item) => /^[0-9a-f-]{36}$/.test(item.id))).toBe(true);
    expect(first.candidates[0]?.initialTasks.map((task) => task.plannedDate)).toEqual([
      "2026-08-09",
      "2026-08-13",
      "2026-08-14",
    ]);
    expect(positioningReportOutputSchema.parse(first)).toEqual(first);
    expect(() => positioningReportRawOutputSchema.parse({
      candidates: [{ ...candidate, id: "model-controlled" }, candidate, candidate],
    })).toThrow();
    expect(() => positioningReportRawOutputSchema.parse({ candidates: [candidate] })).toThrow();
    expect(() =>
      positioningReportRawOutputSchema.parse({
        candidates: [{ ...candidate, citations: Array.from({ length: 6 }, (_, index) => ({ itemId: `i-${index}`, sourceId: `s-${index}` })) }, candidate, candidate],
      }),
    ).toThrow();
  });
});
