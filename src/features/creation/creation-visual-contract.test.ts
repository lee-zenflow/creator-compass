import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("creation visual contract", () => {
  test("keeps request, material, plan and task cards compact", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.creation-material-row[\s\S]*min-height:\s*64px/);
    expect(css).toMatch(/\.creation-plan__section[\s\S]*border-bottom:\s*1px/);
    expect(css).toMatch(/\.creation-task-row\s*\{[^}]*height:\s*84px[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/-webkit-line-clamp:\s*2/);
  });

  test("uses a calm paper surface only for long-form creation copy", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.creation-plan__section\[data-section="body"\]/);
    expect(css).toMatch(/\.creation-plan__section\[data-section="voiceover"\][\s\S]*background:\s*var\(--cc-paper\)/);
  });
});
