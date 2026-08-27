import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("identity and profile visual contract", () => {
  test("auth content keeps a real inset on narrow phones", () => {
    const styles = readFileSync("src/app/globals.css", "utf8");
    expect(styles).toMatch(/\.auth-panel\s*\{[^}]*width:\s*min\(calc\(100% - 30px\),\s*348px\)/);
  });

  test("profile conflicts have a precise recoverable notice", () => {
    const source = readFileSync("src/app/(product)/me/profile/page.tsx", "utf8");
    expect(source).toContain('notice === "conflict"');
    expect(source).toContain("内容已在其他页面更新，请刷新后重试");
  });

  test("me and settings use scoped identity surfaces and real policy links", () => {
    const me = readFileSync("src/app/(product)/me/page.tsx", "utf8");
    const settings = readFileSync("src/app/(product)/me/settings/page.tsx", "utf8");
    expect(me).toContain("me-menu");
    expect(settings).toContain("settings-surface");
    expect(settings).toContain('href="/terms"');
    expect(settings).toContain('href="/privacy"');
  });

  test("identity policy and platform actions keep a 42px mobile target", () => {
    const styles = readFileSync("src/app/globals.css", "utf8");
    for (const selector of [
      ".auth-bar a",
      ".auth-links a",
      ".auth-policy-copy a",
      ".platform-accounts-view .compact-text-action",
      ".legal-links a",
      ".legal-document__footer a",
      ".profile-page .compact-empty a",
    ]) {
      expect(styles).toMatch(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{[^}]*min-height:\\s*42px`));
    }
    for (const selector of [
      ".platform-accounts-view .compact-form input",
      ".platform-accounts-view .compact-form select",
      ".profile-editor input",
      ".profile-editor textarea",
      ".settings-surface .compact-form input",
    ]) {
      expect(styles).toMatch(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{[^}]*min-height:\\s*42px`));
    }
  });

  test("me navigation uses truthful module names instead of borrowing workflow colors", () => {
    const source = readFileSync("src/app/(product)/me/page.tsx", "utf8");
    expect(source).toContain('data-module="platforms"');
    expect(source).toContain('data-module="profile"');
    expect(source).toContain('data-module="reports"');
    expect(source).toContain('data-module="settings"');
    expect(source).toContain('data-module="admin"');
  });
});
