import { describe, expect, test } from "vitest";

import { interviewPolicy } from "./interview-policy";

describe("interview policy", () => {
  test("caps AI-led core questions at ten", () => {
    expect(interviewPolicy({ coreQuestionCount: 9, priorPrompts: [], completeness: 50 })).toMatchObject({
      mayAskCoreQuestion: true,
    });
    expect(interviewPolicy({ coreQuestionCount: 10, priorPrompts: [], completeness: 50 })).toMatchObject({
      mayAskCoreQuestion: false,
    });
  });

  test("offers eighty and one-hundred percent prompts only once", () => {
    expect(interviewPolicy({ coreQuestionCount: 5, priorPrompts: [], completeness: 80 }).prompt).toBe("eighty");
    expect(interviewPolicy({ coreQuestionCount: 5, priorPrompts: ["eighty"], completeness: 90 }).prompt).toBeNull();
    expect(interviewPolicy({ coreQuestionCount: 7, priorPrompts: ["eighty"], completeness: 100 }).prompt).toBe("complete");
    expect(interviewPolicy({ coreQuestionCount: 7, priorPrompts: ["eighty", "complete"], completeness: 100 }).prompt).toBeNull();
  });
});
