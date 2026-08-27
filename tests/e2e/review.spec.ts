import { expect, test } from "@playwright/test";

import { confirmReviewMetricsAndSaveActions, requireE2eInfrastructure, startLocalOwnerSession } from "./helpers";

test("用户确认的数据生成复盘，缺少案例时不会伪造依据", async ({ page }) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);
  const { reportUrl } = await confirmReviewMetricsAndSaveActions(page);
  await page.goto(reportUrl);
  await page.reload();
  await expect(page.getByRole("heading", { name: "已确认的原始数据" })).toBeVisible();
  await expect(page.getByText("仅基于确认数据与个人资料，暂无匹配案例依据")).toBeVisible();
  await page.getByRole("link", { name: "预览任务" }).click();
  await page.getByRole("button", { name: "写入任务中心" }).click();
  await expect(page).toHaveURL(/\/tasks/);
});
