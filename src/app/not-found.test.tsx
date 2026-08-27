import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import NotFound from "./not-found";

describe("brand states", () => {
  test("404 returns to the real product entry", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "页面没有找到" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/workspace");
  });

  test("app and PWA icons share the Creator Compass teal mark", () => {
    expect(readFileSync("src/app/icon.svg", "utf8")).toContain("#397E83");
    expect(readFileSync("public/icon.svg", "utf8")).toContain("#397E83");
  });
});
