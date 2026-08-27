import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskCard } from "./task-card";

const actions = { startAction: vi.fn(), completeAction: vi.fn(), restoreAction: vi.fn(), moveAction: vi.fn() };
function renderCard(status: "pending" | "in_progress" | "completed" | "dismissed", overrides = {}) {
  return render(<TaskCard {...actions} id={`20000000-0000-4000-8000-00000000000${status === "pending" ? 2 : 3}`} title={`${status} 补充素材`} plannedDate="2026-08-19" today="2026-08-20" estimatedMinutes={30} status={status} sourceType="creation" sourceHref="/creation/source" canMoveUp={false} canMoveDown={false} {...overrides} />);
}

describe("TaskCard execution controls", () => {
  it("renders a source icon and real source link", () => {
    renderCard("pending");
    const link = screen.getByRole("link", { name: "查看来源：创作方案" });
    expect(link).toHaveAttribute("href", "/creation/source"); expect(link.querySelector("svg")).not.toBeNull();
  });
  it("offers start and complete for pending tasks", () => {
    renderCard("pending");
    expect(screen.getByRole("button", { name: "开始 pending 补充素材" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成 pending 补充素材" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /恢复/ })).not.toBeInTheDocument();
  });
  it("offers only complete for in-progress tasks", () => {
    renderCard("in_progress");
    expect(screen.getByRole("button", { name: "完成 in_progress 补充素材" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /开始/ })).not.toBeInTheDocument();
  });
  it("offers only restore for completed tasks and never marks them overdue", () => {
    renderCard("pending"); renderCard("completed");
    expect(screen.getByRole("button", { name: "恢复 completed 补充素材" })).toBeInTheDocument();
    expect(screen.getAllByText("已逾期")).toHaveLength(1);
  });
  it("offers no state action for dismissed tasks", () => {
    renderCard("dismissed"); expect(screen.queryByRole("button", { name: /开始|完成|恢复/ })).not.toBeInTheDocument();
  });
  it("enables move controls only for same-date adjacent tasks", () => {
    renderCard("pending", { canMoveUp: true, canMoveDown: false });
    expect(screen.getByRole("button", { name: "上移 pending 补充素材" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下移 pending 补充素材" })).toBeDisabled();
  });
  it("shows priority as visible text instead of color alone", () => {
    renderCard("pending", { priority: 1 }); expect(screen.getByText("高")).toBeVisible();
  });
});
