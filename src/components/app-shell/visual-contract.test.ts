import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const styles = readFileSync(resolve("src/app/globals.css"), "utf8");
const bottomNavSource = readFileSync(
  resolve("src/components/app-shell/bottom-nav.tsx"),
  "utf8",
);

describe("mobile product visual contract", () => {
  test("keeps the 48px header, 62px navigation, and compact content widths", () => {
    expect(styles).toMatch(/calc\(48px \+ env\(safe-area-inset-top\)\)/);
    expect(styles).toMatch(/calc\(62px \+ env\(safe-area-inset-bottom\)\)/);
    expect(styles).toContain("width: min(100%, 390px)");
    expect(styles).toMatch(/\.app-content\s*\{[^}]*padding:\s*8px 15px 14px/);
    expect(styles).toContain("max-width: 348px");
    expect(bottomNavSource).toContain("MODULE_ICONS.workspace");
    expect(bottomNavSource).toContain("size={18}");
    expect(bottomNavSource).toContain("strokeWidth={1.8}");
  });

  test("centers a 390 by 844 teal mobile board on desktop", () => {
    expect(styles).toMatch(
      /\.app-viewport\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*center/,
    );
    expect(styles).toMatch(
      /\.app-shell\s*\{[^}]*background:\s*var\(--cc-bg\)[^}]*overflow-x:\s*clip/,
    );
    expect(styles).toMatch(
      /@media \(min-width:\s*700px\)[\s\S]*?\.app-shell\s*\{[^}]*min-height:\s*844px[^}]*box-shadow:\s*0 0 0 1px var\(--cc-line\)/,
    );
  });

  test("uses compact typography, controls, and the low-saturation teal palette", () => {
    expect(styles).toMatch(/font-family:\s*"Microsoft YaHei"/);
    expect(styles).toContain("font-size: 16px");
    expect(styles).toContain("font-size: 12px");
    expect(styles).toContain("font-size: 11px");
    expect(styles).toContain("height: 42px");
    expect(styles).toContain("min-height: 48px");
    expect(styles).toContain("height: 30px");

    for (const color of [
      "#f4f7f6",
      "#ffffff",
      "#17252b",
      "#397e83",
      "#d9e3e4",
    ]) {
      expect(styles).toContain(color);
    }
  });

  test("defines compass instrument surfaces without purple AI gradients", () => {
    expect(styles).toContain("--cc-ink-deep: #102a33");
    expect(styles).toContain("--cc-coordinate: #2f7075");
    expect(styles).toContain("--cc-grid:");
    expect(styles).toContain(".compass-surface");
    expect(styles).toContain(".instrument-panel");
    expect(styles).toContain(".data-pulse-panel");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(
      "linear-gradient(var(--cc-grid) 1px, transparent 1px),",
    );
    expect(styles).toContain(
      "linear-gradient(90deg, var(--cc-grid) 1px, transparent 1px);",
    );
    expect(styles.match(/linear-gradient\(/g) ?? []).toHaveLength(2);
    expect(styles).not.toMatch(/--[\w-]*(purple|violet)[\w-]*\s*:/i);
    expect(styles).not.toMatch(
      /(?:color|background(?:-color|-image)?|border(?:-color)?|outline-color|box-shadow)\s*:[^;{}]*(?:purple|violet|#(?:4c1d95|6d28d9|7c3aed|8b5cf6|9333ea|a855f7|c084fc|d8b4fe)|hsla?\(\s*(?:2[5-9]\d|3[0-2]\d)(?:deg)?[\s,])/i,
    );
  });

  test("keeps desktop admin layout isolated from the mobile shell", () => {
    expect(styles).toMatch(
      /\.admin-shell\s*\{[^}]*display:\s*grid[^}]*min-width:\s*1024px/,
    );
    expect(styles).toMatch(
      /\.admin-main \.app-shell\s*\{[^}]*display:\s*block[^}]*grid-template-rows:\s*none[^}]*width:\s*100%[^}]*height:\s*auto[^}]*overflow:\s*visible[^}]*border-radius:\s*0/,
    );
    expect(styles).toMatch(
      /\.admin-main \.app-bar__title\s*\{[^}]*position:\s*static[^}]*max-width:\s*none[^}]*transform:\s*none/,
    );
  });

  test("keeps shared groups and empty states compact", () => {
    expect(styles).toMatch(/\.compact-page\s*\{[^}]*gap:\s*8px/);
    expect(styles).toMatch(/\.compact-stack\s*\{[^}]*gap:\s*6px/);
    expect(styles).toMatch(/\.compact-empty\s*\{[^}]*padding:\s*12px 4px/);
    expect(styles).not.toMatch(/\.compact-empty\s*\{[^}]*border:\s*1px dashed/);
  });

  test("uses a true three-column app bar with a compact coordinate", () => {
    expect(styles).toMatch(
      /\.app-bar\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(42px, 1fr\) minmax\(0, 64%\) minmax\(42px, 1fr\)/,
    );
    expect(styles).not.toMatch(
      /\.app-bar\s*\{[^}]*grid-template-columns:[^;]*\bauto\b/,
    );
    expect(styles).toMatch(
      /\.app-bar__title\s*\{[^}]*grid-column:\s*2[^}]*justify-self:\s*center[^}]*max-width:\s*100%/,
    );
    expect(styles).not.toMatch(
      /\.app-bar__title\s*\{[^}]*max-width:\s*64%/,
    );
    expect(styles).toMatch(
      /\.app-bar__coordinate\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/,
    );
    expect(styles).toMatch(
      /\.app-bar__back\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/,
    );
  });

  test("aligns record icons and keeps the material disclosure compact", () => {
    expect(styles).toMatch(/\.record-source\s*\{[^}]*display:\s*inline-flex[^}]*gap:\s*4px/);
    expect(styles).toMatch(/\.task-card__meta,[\s\S]*?\.task-preview__meta\s*\{[^}]*overflow:\s*hidden[^}]*white-space:\s*nowrap/);
    expect(styles).toMatch(/\.compact-disclosure\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*border-radius:\s*8px/);
    expect(styles).toMatch(/\.compact-disclosure > summary\s*\{[^}]*min-height:\s*48px/);
  });
});
