import { expect, test } from "@playwright/test";

import { createContentPlanAndSaveTasks, requireE2eInfrastructure, startLocalOwnerSession } from "./helpers";

test("创作需求、生成方案和执行任务在刷新后仍存在", async ({ page }) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);
  const { planUrl } = await createContentPlanAndSaveTasks(page);
  await page.goto(planUrl);
  await page.reload();
  await expect(page.locator("main")).toContainText("一次真实实践后的完整复盘");
  await page.getByRole("link", { name: "预览执行任务" }).click();
  await page.getByRole("button", { name: "写入任务中心" }).click();
  await expect(page).toHaveURL(/\/tasks/);
});
