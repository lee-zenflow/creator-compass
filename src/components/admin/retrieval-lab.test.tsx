import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/features/admin/admin-actions", () => ({
  testKnowledgeRetrievalAction: vi.fn(async () => ({ ok: true, hits: [] })),
}));

import { RetrievalLab } from "./retrieval-lab";

describe("RetrievalLab", () => {
  test("renders query controls and does not invent result cards", () => {
    render(<RetrievalLab />);
    expect(screen.getByLabelText("平台")).toBeInTheDocument();
    expect(screen.getByLabelText("内容类型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行审核检视" })).toBeInTheDocument();
    expect(screen.getByText("尚未运行检索")).toBeInTheDocument();
    expect(screen.queryByText("示例命中")).not.toBeInTheDocument();
  });

  test("shows score contributions and filtered reasons only in the admin lab", () => {
    render(<RetrievalLab initialResult={{
      ok: true,
      candidateCount: 3,
      acceptedCandidateCount: 1,
      excludedCandidateCount: 2,
      inspectionLimit: 200,
      reasonCounts: { SOURCE_NOT_APPROVED: 2 },
      hits: [{
        kind: "knowledge",
        sourceName: "已审核来源",
        title: "真实命中",
        excerpt: "正文",
        version: 1,
        score: 35,
        matchMode: "deterministic_text",
        signals: [{ kind: "exact_tag", value: "定位", contribution: 5 }],
      }],
    }} />);

    expect(screen.getByTestId("retrieval-hit")).toBeInTheDocument();
    expect(screen.getByText("标签完全匹配 定位 +5")).toBeInTheDocument();
    expect(screen.getByText("来源未通过审核：2 次")).toBeInTheDocument();
    expect(screen.getByText("本次窗口上限 200 条；检查 3 条候选，1 条通过，2 条被排除。过滤原因可重叠，按规则触发次数统计。"))
      .toBeInTheDocument();
  });
});
