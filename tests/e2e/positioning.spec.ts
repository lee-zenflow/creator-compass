import { expect, test } from "@playwright/test";

import {
  completePositioning,
  confirmCandidateAndSaveTasks,
  requireE2eInfrastructure,
  startLocalOwnerSession,
} from "./helpers";

test("访谈、三候选、确认、任务和档案在刷新后保持一致", async ({ page }) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);
  await completePositioning(page);
  await confirmCandidateAndSaveTasks(page);
  await page.reload();
  await expect(page.locator("main")).toContainText("整理产品学习复盘素材");
  await page.goto("/me/profile");
  await expect(page.getByLabel("当前定位")).toHaveValue("产品学习复盘");
});
