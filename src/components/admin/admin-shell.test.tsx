import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AdminShell } from "./admin-shell";

describe("AdminShell", () => {
  test("exposes all operational modules with a consistent icon menu", () => {
    const { container } = render(
      <AdminShell title="知识运营">
        <p>真实后台内容</p>
      </AdminShell>,
    );

    expect(screen.getByRole("heading", { name: "知识运营" })).toBeInTheDocument();
    expect(screen.getByText("真实后台内容")).toBeInTheDocument();

    for (const label of [
      "知识概览",
      "知识来源",
      "审核队列",
      "检索试验",
      "平台规则",
      "提示词",
      "AI 异常",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }

    const icons = container.querySelectorAll(".admin-nav svg");
    expect(icons).toHaveLength(7);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("width", "18");
      expect(icon).toHaveAttribute("height", "18");
      expect(icon).toHaveAttribute("stroke-width", "1.8");
    }
  });

  test("keeps the admin console outside the mobile application board", () => {
    const { container } = render(
      <AdminShell title="知识来源">
        <p>内容</p>
      </AdminShell>,
    );

    expect(container.querySelector(".admin-shell")).toBeInTheDocument();
    expect(container.querySelector(".app-viewport")).not.toBeInTheDocument();
  });
});
