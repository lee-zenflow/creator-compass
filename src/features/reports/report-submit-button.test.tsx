import { render, screen } from "@testing-library/react";
import { vi, expect, test } from "vitest";

vi.mock("react-dom", () => ({
  useFormStatus: () => ({ pending: true }),
}));

import { ReportSubmitButton } from "./report-submit-button";

test("disables lifecycle actions while the server action is pending", () => {
  render(<ReportSubmitButton label="归档本轮复盘">归档</ReportSubmitButton>);
  expect(screen.getByRole("button", { name: "归档本轮复盘" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "归档本轮复盘" })).toHaveAttribute("aria-busy", "true");
});
