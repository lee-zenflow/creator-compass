import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import {
  CandidateCards,
  InterviewPanel,
  PositioningRecordList,
  PositioningTaskCards,
  shouldDefaultSelectTask,
} from "./positioning-ui";

describe("compact positioning UI", () => {
  test("record list shows persisted completeness and no invented names", () => {
    render(<PositioningRecordList records={[{ id: "s1", status: "draft", completeness: 62, currentStep: 4, createdAt: new Date("2026-08-09"), updatedAt: new Date("2026-08-09") }]} />);
    expect(screen.getByText("新建定位 · 08月09日")).toBeInTheDocument();
    expect(screen.getByText("画像完整度 62% · 可继续访谈")).toBeInTheDocument();
    expect(screen.queryByText(/校园|案例/)).not.toBeInTheDocument();
  });

  test("interview progress is the persisted percentage", () => {
    render(<InterviewPanel sessionId="s1" completeness={72} messages={[]} latestRun={null} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "72");
    expect(screen.queryByText(/正在分析 80%|预计完成/)).not.toBeInTheDocument();
  });

  test("keeps manual profile supplementation open after ten core rounds below the report threshold", () => {
    render(<InterviewPanel sessionId="s1" currentStep={10} completeness={62} messages={[]} latestRun={null} />);

    expect(screen.getByText("10轮核心访谈已完成，可继续补充画像信息")).toBeInTheDocument();
    expect(screen.queryByText("10轮核心访谈已完成，可继续补充画像信息或生成报告")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
  });

  test("offers report generation after ten core rounds only at the persisted threshold", () => {
    render(<InterviewPanel sessionId="s1" currentStep={10} completeness={80} messages={[]} latestRun={null} />);

    expect(screen.getByText("10轮核心访谈已完成，可继续补充画像信息或生成报告")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
  });

  test("defers failed-run recovery to the single page action", () => {
    render(<InterviewPanel sessionId="s1" completeness={72} messages={[]} latestRun={{
      id: "r1", taskType: "profile_extract", status: "failed", errorCode: "TIMEOUT", safeErrorDetail: "不可直接展示的底层错误",
    }} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("不可直接展示的底层错误")).not.toBeInTheDocument();
  });

  test("report processing only states the persisted run status", () => {
    render(<InterviewPanel sessionId="s1" completeness={81} messages={[]} latestRun={{ id: "r1", taskType: "positioning_report", status: "processing", errorCode: null, safeErrorDetail: null }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("请求已保存，AI 正在处理");
    expect(status.closest("[data-phase]"))?.toHaveAttribute("data-phase", "processing");
    expect(screen.queryByText("正在检索已审核资料")).not.toBeInTheDocument();
    expect(screen.queryByText("正在生成定位方案")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "报告生成状态" })).not.toBeInTheDocument();
    expect(status).not.toHaveTextContent(/预计|\d+%|将会使用|仅会使用/);
  });

  test("positioning page uses the shared recovery with one stable retry intent", () => {
    const page = readFileSync("src/app/(product)/positioning/[sessionId]/page.tsx", "utf8");

    expect(page).toContain("<RecoveryAction");
    expect(page).toContain("safeDetail={flow.latestRun.safeErrorDetail}");
    expect(page).toContain("`retry:${flow.latestRun.id}`");
    expect(page).not.toContain("`retry:${flow.latestRun.id}:${crypto.randomUUID()}`");
    expect(page).toContain("const canRetryFailedRun =");
    expect(page).toContain("recoveryFor(flow.latestRun.errorCode, flow.latestRun.safeErrorDetail).retryable");
    expect(page).toContain("canRetryFailedRun ? (");
  });

  test("positioning page switches the composer to truthful supplementation copy after ten rounds", () => {
    const page = readFileSync("src/app/(product)/positioning/[sessionId]/page.tsx", "utf8");

    expect(page).toContain("const coreInterviewComplete = flow.session.currentStep >= 10;");
    expect(page).toContain('const composerLabel = coreInterviewComplete ? "补充画像信息" : "输入你的回答";');
    expect(page).toContain('const composerAction = coreInterviewComplete ? "补充" : "发送";');
    expect(page).toContain("placeholder={composerLabel} aria-label={composerLabel}");
    expect(page).toContain("{composerAction}</button>");
  });

  test("candidate list stays at three compact choices", () => {
    const base = { audience: "大学生", direction: "真实场景测试", contentPillars: ["实测", "教程", "复盘"], matchExplanation: "访谈证据匹配", risks: [], citations: [], initialTasks: [] };
    render(<CandidateCards sessionId="s1" reportId="r1" reportVersion={1} candidates={[
      { ...base, id: "a", name: "方向 A" }, { ...base, id: "b", name: "方向 B" }, { ...base, id: "c", name: "方向 C" },
    ]} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  test("candidate list clamps generated explanations and links to details", () => {
    const longExplanation = "这是一段很长的匹配说明，用于验证列表只展示两行摘要，完整正文必须进入详情页查看，不能继续把候选卡片向下撑高。";
    render(<CandidateCards sessionId="s1" reportId="r1" reportVersion={1} candidates={[{
      id: "a", name: "方向 A", audience: "大学生", direction: "真实场景测试",
      contentPillars: ["实测"], matchExplanation: longExplanation, risks: [], citations: [], initialTasks: [],
    }]} />);

    expect(screen.getByTestId("candidate-summary")).toHaveClass("line-clamp-2");
    const coordinate = screen.getByText("POSITION 01");
    expect(coordinate).toHaveAttribute("aria-hidden", "true");
    expect(coordinate.closest("article")).toHaveAttribute("data-candidate-index", "1");
    expect(screen.getByRole("link", { name: "查看详情 ›" })).toBeInTheDocument();
  });

  test("candidate detail names missing case evidence explicitly", () => {
    const page = readFileSync("src/app/(product)/positioning/[sessionId]/report/[candidateId]/page.tsx", "utf8");

    expect(page).toContain("暂无匹配案例依据");
  });

  test("task preview uses only generated tasks", () => {
    render(<PositioningTaskCards now={new Date("2026-08-09T00:00:00Z")} tasks={[{ id: "t1", title: "列出真实工具", reason: "验证方向", steps: ["记录效率工具"], plannedDate: "2026-08-10", completionCriteria: "列出5个工具", estimatedMinutes: 20, priority: 1 }]} />);
    expect(screen.getByText("列出真实工具")).toBeInTheDocument();
    expect(screen.getByText("步骤：记录效率工具")).toHaveClass("task-card__steps", "line-clamp-2");
    expect(screen.queryByText(/示例任务|推荐案例/)).not.toBeInTheDocument();
  });

  test("defaults only executable high-priority tasks within three days", () => {
    expect(shouldDefaultSelectTask({ plannedDate: "2026-08-11", priority: 1, steps: ["执行"] }, new Date("2026-08-09T00:00:00Z"))).toBe(true);
    expect(shouldDefaultSelectTask({ plannedDate: "2026-08-15", priority: 1, steps: ["执行"] }, new Date("2026-08-09T00:00:00Z"))).toBe(false);
    expect(shouldDefaultSelectTask({ plannedDate: "2026-08-10", priority: 2, steps: ["执行"] }, new Date("2026-08-09T00:00:00Z"))).toBe(false);
    expect(shouldDefaultSelectTask({ plannedDate: "2026-08-10", priority: 1, steps: [] }, new Date("2026-08-09T00:00:00Z"))).toBe(false);
  });
});
