import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import { ReportList } from "./report-list";

const styles = readFileSync("src/app/globals.css", "utf8");

test("renders a real report href with type icon, status, date, and clamped copy", () => {
  render(
    <ReportList
      reports={[
        {
          id: "r1",
          href: "/reports?report=r1",
          type: "review",
          title: "本轮复盘",
          summary: "保留有效方法并调整下一轮内容结构",
          status: "ready",
          updatedAt: "2026/8/13",
        },
      ]}
    />,
  );

  expect(screen.getByLabelText("类型：复盘报告").querySelector("svg")).not.toBeNull();
  expect(screen.getByText("已完成 · 2026/8/13")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /本轮复盘/ })).toHaveAttribute(
    "href",
    "/reports?report=r1",
  );
  expect(screen.getByText(/保留有效方法/)).toHaveClass("line-clamp-1");
  expect(screen.getByText("本轮复盘")).toHaveClass("line-clamp-1");
});

test("renders compact archive controls and real domain history metadata", () => {
  render(
    <ReportList
      archivedView={false}
      reports={[{
        id: "r1",
        href: "/reports?report=r1",
        domainHref: "/reviews/review-1/report?report=r1&version=2",
        type: "review",
        title: "本轮复盘",
        summary: "保留有效方法并调整下一轮内容结构",
        status: "ready",
        updatedAt: "2026/8/20",
        latestVersion: 2,
        generationMode: "manual",
      }]}
    />,
  );

  expect(screen.getByText("V2 · 人工调整")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "打开原报告" })).toHaveAttribute(
    "href",
    "/reviews/review-1/report?report=r1&version=2",
  );
  expect(screen.getByRole("button", { name: "归档本轮复盘" })).toBeInTheDocument();
  expect(styles).toMatch(/\.report-card\s*\{[^}]*height:\s*64px/);
  expect(styles).toMatch(/\.report-card__main\s*\{[^}]*min-height:\s*42px/);
  expect(styles).toMatch(/\.compact-icon-action\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/);
});

test("renders URL-restorable type filters while preserving archived view", () => {
  render(<ReportList activeType="review" archivedView reports={[{
    id: "r1",
    href: "/reports?report=r1&view=archived&type=review",
    type: "review",
    title: "本轮复盘",
    summary: null,
    status: "archived",
  }]} />);

  expect(screen.getByRole("link", { name: "全部" })).toHaveAttribute("href", "/reports?view=archived");
  expect(screen.getByRole("link", { name: "定位" })).toHaveAttribute(
    "href",
    "/reports?view=archived&type=positioning",
  );
  expect(screen.getByRole("link", { name: "复盘" })).toHaveAttribute("aria-current", "page");
  const form = document.querySelector("form");
  expect(form?.querySelector('input[name="type"]')).toHaveValue("review");
  expect(form?.querySelector('input[name="view"]')).toHaveValue("archived");
  expect(screen.getByRole("button", { name: "恢复本轮复盘" })).toBeInTheDocument();
});
