import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import ToolsPage from "@/app/(product)/tools/page";

describe("tools view", () => {
  test("renders five compact entries with one unified module icon each", () => {
    render(<ToolsPage />);

    const entries = screen.getAllByTestId("tool-entry");
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.getAttribute("href"))).toEqual([
      "/positioning",
      "/creation/new",
      "/reviews/new",
      "/materials",
      "/reports",
    ]);
    expect(entries.map((entry) => entry.getAttribute("data-module"))).toEqual([
      "positioning",
      "creation",
      "review",
      "materials",
      "reports",
    ]);
    for (const entry of entries) {
      expect(entry.querySelector(".module-icon")).not.toBeNull();
    }
    expect(screen.getByText("MODULE INDEX · 05")).toBeInTheDocument();
  });
});
