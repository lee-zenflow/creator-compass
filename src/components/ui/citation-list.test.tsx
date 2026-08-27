import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { CitationList } from "./citation-list";

test("shows an honest no-hit message", () => {
  render(<CitationList citations={[]} emptyDetail="仅基于本次访谈信息，暂无匹配案例依据" />);
  expect(screen.getByText("仅基于本次访谈信息，暂无匹配案例依据")).toBeInTheDocument();
});

test("shows readable evidence without internal identifiers or scores", () => {
  render(<CitationList citations={[{
    itemId: "internal-item",
    sourceId: "internal-source",
    title: "定位访谈方法",
    sourceName: "公开研究资料",
    sourceType: "public_web",
    summary: "通过访谈确认目标人群与内容方向。",
    reviewedAt: new Date("2026-08-13"),
    publicUrl: "https://example.com/source",
  }]} />);
  expect(screen.getByRole("link", { name: "定位访谈方法" })).toHaveAttribute("href", "https://example.com/source");
  expect(screen.queryByText("internal-item")).not.toBeInTheDocument();
  expect(screen.queryByText(/匹配分/)).not.toBeInTheDocument();
});
