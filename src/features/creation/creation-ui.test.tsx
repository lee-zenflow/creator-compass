import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { readFileSync } from "node:fs";

import { ContentPlanView, CreationTaskRows } from "./creation-ui";

describe("creation compact UI", () => {
  test.each([
    {
      contentType: "video" as const,
      plan: {
        contentType: "video" as const,
        hooks: ["先给结果"], storyboard: ["镜头一"], voiceover: "口播稿", shootingSteps: ["拍摄"],
        riskNotes: [], citations: [], tasks: [],
      },
      sections: [["开头钩子", "hooks"], ["分镜", "storyboard"], ["口播稿", "voiceover"], ["拍摄步骤", "shooting-steps"]],
    },
    {
      contentType: "article" as const,
      plan: {
        contentType: "article" as const,
        titleSuggestions: ["标题"], outline: ["正文结构"], body: "完整正文", imageSuggestions: ["配图"],
        riskNotes: [], citations: [], tasks: [],
      },
      sections: [["标题建议", "title-suggestions"], ["正文结构", "outline"], ["完整正文", "body"], ["配图建议", "image-suggestions"]],
    },
    {
      contentType: "copy" as const,
      plan: {
        contentType: "copy" as const,
        titleSuggestions: ["标题"], body: "完整文案", publishingGuide: ["发布引导"],
        riskNotes: [], citations: [], tasks: [],
      },
      sections: [["标题建议", "title-suggestions"], ["完整文案", "body"], ["发布引导", "publishing-guide"]],
    },
  ])("maps $contentType sections to stable execution-route coordinates", ({ plan, sections }) => {
    render(<ContentPlanView plan={plan} />);

    for (const [title, id] of sections) {
      expect(screen.getByRole("heading", { level: 3, name: title }).closest("section")).toHaveAttribute("data-section", id);
    }
    expect(screen.getByText("风险提醒").closest("section")).toHaveAttribute("data-section", "risk-notes");
    expect(screen.getByText("参考依据").closest("section")).toHaveAttribute("data-section", "evidence");
  });

  test("renders video sections and truthful empty evidence", () => {
    render(<ContentPlanView plan={{
      contentType: "video", hooks: ["先给结果"], storyboard: ["镜头一"], voiceover: "口播稿",
      shootingSteps: ["拍摄"], riskNotes: [], citations: [], tasks: [{
        id: "10000000-0000-4000-8000-000000000001", title: "拍摄", reason: "验证",
        steps: ["拍摄"], completionCriteria: "成片", estimatedMinutes: 30, priority: 1,
        plannedDate: "2026-08-09",
      }],
    }} />);
    expect(screen.getByText("开头钩子")).toBeInTheDocument();
    expect(screen.getByText("仅基于创作需求、档案与已选素材，暂无匹配案例依据")).toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveClass("creation-plan");
  });

  test("task rows clamp long generated steps", () => {
    render(<CreationTaskRows tasks={[{
      id: "10000000-0000-4000-8000-000000000001", title: "拍摄并剪辑内容", reason: "验证",
      steps: ["整理一段很长的拍摄清单", "完成逐镜头拍摄", "剪辑并检查字幕"],
      completionCriteria: "成片", estimatedMinutes: 30, priority: 1, plannedDate: "2026-08-09",
    }]} />);

    expect(screen.getByText(/整理一段很长的拍摄清单/)).toHaveClass("task-card__steps", "line-clamp-2");
  });

  test("creation processing copy only states database-confirmed facts", () => {
    const page = readFileSync("src/app/(product)/creation/[projectId]/plan/page.tsx", "utf8");

    expect(page).toContain("请求已保存，AI 正在处理");
    expect(page).not.toMatch(/生成时会校验|正在生成结构化内容方案/);
  });

  test("creation failure uses the shared safe recovery and stable failed run id", () => {
    const page = readFileSync("src/app/(product)/creation/[projectId]/plan/page.tsx", "utf8");

    expect(page).toContain("<RecoveryAction");
    expect(page).toContain("failedRunId: state.latestRun.id");
    expect(page).toContain("safeDetail={state.latestRun.safeErrorDetail}");
    expect(page).not.toContain("retry:${randomUUID()}");
  });
});
