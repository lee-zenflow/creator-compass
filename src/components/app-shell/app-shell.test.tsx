import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AppShell } from "./app-shell";

test("renders four labelled 18px icon tabs", () => {
  const { container } = render(
    <AppShell title="工作台" activeTab="workspace">
      <p>内容</p>
    </AppShell>,
  );

  expect(screen.getByRole("heading", { name: "工作台" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();

  for (const label of ["工作台", "工具箱", "任务", "我的"]) {
    expect(
      screen.getByRole("link", { name: new RegExp(label) }),
    ).toBeInTheDocument();
  }

  const icons = container.querySelectorAll(".bottom-nav svg");
  expect(icons).toHaveLength(4);

  for (const icon of icons) {
    expect(icon).toHaveAttribute("width", "18");
    expect(icon).toHaveAttribute("height", "18");
    expect(icon).toHaveAttribute("stroke-width", "1.8");
  }

  expect(screen.getByRole("link", { name: "工作台" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute(
    "href",
    "#main-content",
  );
  expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
});

test("renders a back action and sticky footer without bottom navigation", () => {
  render(
    <AppShell
      title="任务详情"
      backHref="/tasks"
      bottomNav={false}
      stickyFooter={<button type="button">保存调整</button>}
    >
      <p>详情内容</p>
    </AppShell>,
  );

  expect(screen.getByRole("link", { name: "返回" })).toHaveAttribute("href", "/tasks");
  expect(screen.getByRole("button", { name: "保存调整" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
});

test("keeps back, coordinate, centered title, and right action together", () => {
  const { container } = render(
    <AppShell
      title="定位报告"
      coordinate="REPORT · POSITION 03"
      backHref="/reports"
      bottomNav={false}
      rightAction={<button type="button">分享</button>}
    >
      <p>报告正文</p>
    </AppShell>,
  );

  const header = container.querySelector(".app-bar");
  const title = screen.getByRole("heading", { name: "定位报告" });
  const coordinate = screen.getByText("REPORT · POSITION 03");

  expect(header).not.toBeNull();
  expect(title.parentElement).toBe(header);
  expect(screen.getByRole("link", { name: "返回" })).toHaveAttribute(
    "href",
    "/reports",
  );
  expect(coordinate).toHaveAttribute("aria-hidden", "true");
  expect(coordinate).toHaveAttribute("translate", "no");
  expect(screen.getByRole("button", { name: "分享" })).toBeInTheDocument();
});

test("does not render an empty coordinate on detail pages", () => {
  const { container } = render(
    <AppShell title="任务详情" backHref="/tasks" bottomNav={false}>
      <p>详情</p>
    </AppShell>,
  );

  expect(container.querySelector(".app-bar__coordinate")).not.toBeInTheDocument();
});

if (false) {
  // @ts-expect-error A shell with bottom navigation requires an active tab.
  <AppShell title="缺少标签页">正文</AppShell>;
  // @ts-expect-error A shell without bottom navigation must not receive an active tab.
  <AppShell title="详情" bottomNav={false} activeTab="workspace">
    正文
  </AppShell>;
}
