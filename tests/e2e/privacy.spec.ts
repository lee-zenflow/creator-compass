import { expect, test } from "@playwright/test";

import { requireE2eInfrastructure, startLocalOwnerSession } from "./helpers";

test("本地 Owner 可导出自己的数据，导出内容不包含密码和令牌", async ({ page }) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);
  const downloadPromise = page.waitForEvent("download");
  await page.goto("/me/settings");
  await page.getByRole("link", { name: "下载 JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await import("node:fs/promises").then((fs) => fs.readFile(path!, "utf8"));
  expect(content).not.toMatch(/password|token|secret/i);
  await page.reload();
  await expect(page.getByText(/导出创作档案、定位、创作、素材、复盘、任务、报告和设置/)).toBeVisible();
});
