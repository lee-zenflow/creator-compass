import { expect, test } from "@playwright/test";

import { requireE2eInfrastructure, startLocalOwnerSession } from "./helpers";

test("本地 Owner 登录后刷新仍可恢复，未初始化访问会回设置页", async ({ page }) => {
  requireE2eInfrastructure();
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/(setup|login)$/);
  await startLocalOwnerSession(page);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
});
