import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { ReviewReportView, ReviewTaskRows } from "./review-ui";

describe("review report UI", () => {
  test("maps report sections to stable coordinates and limits data pulse to metrics", () => {
    render(<ReviewReportView
      confirmedMetrics={{ views: 100 }}
      calculatedMetrics={{ interactionRate: null }}
      report={{
        dataSummary: {}, retained: [], problems: [], causes: [], actions: [], citations: [],
      }}
      citations={[]}
    />);

    const sections = [
      ["已确认的原始数据", "confirmed-metrics"],
      ["程序计算", "calculated-metrics"],
      ["AI复盘结论", "conclusion"],
      ["参考依据", "evidence"],
      ["下一轮行动", "actions"],
    ] as const;
    for (const [title, id] of sections) {
      expect(screen.getByText(title).closest("section")).toHaveAttribute("data-section", id);
    }

    expect(screen.getByText("已确认的原始数据").closest("section")).toHaveClass("data-pulse-panel");
    expect(screen.getByText("程序计算").closest("section")).toHaveClass("data-pulse-panel");
    for (const title of ["AI复盘结论", "参考依据", "下一轮行动"]) {
      expect(screen.getByText(title).closest("section")).not.toHaveClass("data-pulse-panel");
    }
    expect(screen.getByText("无法计算")).toBeInTheDocument();
  });

  test("scopes metric typography and borders to the local data pulse surface", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.review-report__section\.data-pulse-panel \.review-metrics\s*\{[^}]*border-color:/);
    expect(css).toMatch(/\.review-report__section\.data-pulse-panel \.review-metrics > div\s*\{[^}]*border-color:/);
    expect(css).toMatch(/\.review-report__section\.data-pulse-panel \.review-metrics dt\s*\{[^}]*color:/);
    expect(css).toMatch(/\.review-report__section\.data-pulse-panel \.review-metrics dd\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  test("labels source data, deterministic calculations and AI conclusions separately", () => {
    render(<ReviewReportView
      confirmedMetrics={{ views: 1_000, likes: 40 }}
      calculatedMetrics={{ interactionCount: 40, interactionRate: 0.04, followerConversionRate: null, viewGrowthRate: null, interactionRateChange: null }}
      report={{
        dataSummary: { 结论: "互动率 4%" }, retained: ["保留标题"], problems: ["收藏偏低"], causes: ["清单不够具体"],
        actions: [{ id: "10000000-0000-4000-8000-000000000001", title: "补充清单", reason: "验证收藏", steps: ["整理"], completionCriteria: "发布", estimatedMinutes: 30, priority: 1, plannedDate: "2026-08-10" }],
        citations: [],
      }}
      citations={[]}
    />);
    expect(screen.getByText("已确认的原始数据")).toBeInTheDocument();
    expect(screen.getByText("程序计算")).toBeInTheDocument();
    expect(screen.getByText("AI复盘结论")).toBeInTheDocument();
    expect(screen.getByText("仅基于确认数据与个人资料，暂无匹配案例依据")).toBeInTheDocument();
  });

  test("marks legacy source-only evidence without exposing internal ids", () => {
    const internalId = "20000000-0000-4000-8000-000000000002";
    render(<ReviewReportView
      confirmedMetrics={{ views: 100 }}
      calculatedMetrics={{ interactionRate: 0.1 }}
      report={{ dataSummary: {}, retained: [], problems: [], causes: [], actions: [], citations: [] }}
      citations={[]}
      legacySources={[{ id: internalId, name: "平台规则库", publicUrl: null }]}
    />);

    expect(screen.getByText("历史报告仅保留来源级依据，无法追溯到具体资料片段；请重新生成后再编辑。")).toBeInTheDocument();
    expect(screen.getByText("平台规则库")).toBeInTheDocument();
    expect(screen.queryByText(internalId)).not.toBeInTheDocument();
  });

  test("task rows clamp long generated steps", () => {
    render(<ReviewTaskRows tasks={[{
      id: "10000000-0000-4000-8000-000000000001", title: "补充具体清单", reason: "验证收藏",
      steps: ["整理一段很长的执行步骤", "补充真实案例", "发布后记录数据"],
      completionCriteria: "发布", estimatedMinutes: 30, priority: 1, plannedDate: "2026-08-10",
    }]} />);

    expect(screen.getByText(/整理一段很长的执行步骤/)).toHaveClass("task-card__steps", "line-clamp-2");
  });

  test("review processing copy only states database-confirmed facts", () => {
    const page = readFileSync("src/app/(product)/reviews/[reviewId]/report/page.tsx", "utf8");

    expect(page).toContain("请求已保存，AI 正在处理");
    expect(page).not.toMatch(/生成时会校验|正在生成结构化复盘/);
  });

  test("review failure uses the shared safe recovery and stable failed run id", () => {
    const page = readFileSync("src/app/(product)/reviews/[reviewId]/report/page.tsx", "utf8");

    expect(page).toContain("<RecoveryAction");
    expect(page).toContain("failedRunId: state.latestRun.id");
    expect(page).toContain("safeDetail={state.latestRun.safeErrorDetail}");
    expect(page).not.toContain("retry:${randomUUID()}");
  });
});
