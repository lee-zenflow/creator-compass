import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { CompactSkeleton } from "./compact-skeleton";

describe("CompactSkeleton", () => {
  test("matches the real workspace metric and row density", () => {
    render(<CompactSkeleton variant="workspace" />);

    expect(screen.getAllByTestId("skeleton-metric")).toHaveLength(3);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(3);
    expect(screen.getByLabelText("正在加载工作台")).toBeInTheDocument();
  });

  test("matches three candidates and four task rows", () => {
    const { rerender } = render(<CompactSkeleton variant="candidates" />);
    expect(screen.getAllByTestId("skeleton-candidate")).toHaveLength(3);

    rerender(<CompactSkeleton variant="tasks" />);
    expect(screen.getAllByTestId("skeleton-task")).toHaveLength(4);
  });

  test("keeps skeleton heights aligned to the Figma mobile cards", () => {
    const styles = readFileSync("src/app/globals.css", "utf8");
    expect(styles).toMatch(/skeleton-candidate[^}]*height:\s*148px/);
    expect(styles).toMatch(/skeleton-task[^}]*height:\s*84px/);
    expect(styles).toMatch(/prefers-reduced-motion[^]*compact-skeleton/);
  });
});
