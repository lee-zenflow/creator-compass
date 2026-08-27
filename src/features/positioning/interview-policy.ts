export type InterviewPrompt = "eighty" | "complete";

export function interviewPolicy(input: {
  coreQuestionCount: number;
  priorPrompts: InterviewPrompt[];
  completeness: number;
}) {
  const seen = new Set(input.priorPrompts);
  const prompt =
    input.completeness === 100 && !seen.has("complete")
      ? "complete"
      : input.completeness >= 80 && !seen.has("eighty")
        ? "eighty"
        : null;
  return {
    mayAskCoreQuestion: input.coreQuestionCount < 10,
    prompt: prompt as InterviewPrompt | null,
  };
}
