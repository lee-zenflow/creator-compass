import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  requireE2eInfrastructure,
  startLocalOwnerSession,
} from "./helpers";

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}×${viewport.height} 保持真实手机层级与可访问入口`, async ({ page }) => {
    requireE2eInfrastructure();
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await startLocalOwnerSession(page);

    await expect(page.getByTestId("current-step")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const shell = page.locator(".app-shell");
    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(Math.round(shellBox!.width)).toBe(Math.min(viewport.width, 390));
    expect(Math.round(shellBox!.height)).toBe(viewport.height);

    const moduleIcon = page.locator(".module-icon").first();
    await expect(moduleIcon).toBeVisible();
    await expect(moduleIcon).toHaveCSS("width", "32px");
    await expect(moduleIcon.locator("svg")).toHaveAttribute("width", "18");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "跳到主要内容" });
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.goto("/this-route-does-not-exist");
    await expect(page.getByRole("heading", { name: "页面没有找到" })).toBeVisible();
    await expect(page.getByRole("link", { name: "返回工作台" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
}
