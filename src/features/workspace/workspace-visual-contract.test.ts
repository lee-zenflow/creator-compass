import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

test("keeps workspace rows within the Figma density", () => {
  expect(styles).toMatch(/\.workspace-account\s*\{[^}]*min-height:\s*40px/);
  expect(styles).toMatch(/\.workspace-metrics > div\s*\{[^}]*min-height:\s*54px/);
  expect(styles).toMatch(/\.workspace-chart\s*\{[^}]*height:\s*72px/);
  expect(styles).toMatch(/\.workspace-task\s*\{[^}]*min-height:\s*44px/);
  expect(styles).toMatch(/\.workspace-report\s*\{[^}]*min-height:\s*48px/);
  expect(styles).toMatch(/\.current-step-row\s*\{[^}]*min-height:\s*68px/);
});
