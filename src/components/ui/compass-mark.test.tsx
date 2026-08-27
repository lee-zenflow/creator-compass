import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { CompassMark } from "./compass-mark";

test("renders an accessible compass mark without readable inner text", () => {
  const { container } = render(
    <CompassMark label="Creator Compass" size="small" />,
  );

  const mark = screen.getByRole("img", { name: "Creator Compass" });
  expect(mark).toHaveAttribute("data-size", "small");
  expect(mark).not.toHaveAttribute("aria-hidden");
  expect(mark).toHaveTextContent("");
  expect(container.querySelectorAll(".compass-mark__ring")).toHaveLength(1);
  expect(container.querySelectorAll(".compass-mark__needle")).toHaveLength(1);
});

test("renders a decorative compass mark outside the accessibility tree", () => {
  const { container } = render(<CompassMark decorative size="medium" />);

  const mark = container.querySelector(".compass-mark");
  expect(mark).toHaveAttribute("aria-hidden", "true");
  expect(mark).not.toHaveAttribute("role");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

if (false) {
  // @ts-expect-error Accessible marks require a label.
  <CompassMark />;
  // @ts-expect-error Decorative marks must not expose an accessible label.
  <CompassMark decorative label="Creator Compass" />;
}
