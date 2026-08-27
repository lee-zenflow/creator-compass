import { expect, test } from "@playwright/test";

import {
  completePositioning,
  confirmCandidateAndSaveTasks,
  confirmReviewMetricsAndSaveActions,
  createMaterialForFlow,
  createContentPlanAndSaveTasks,
  requireE2eInfrastructure,
  startLocalOwnerSession,
} from "./helpers";

test.setTimeout(180_000);

test("本地 Owner 完成定位、创作、复盘与任务闭环，刷新后数据保持一致", async ({ page }) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);
  const materialName = `闭环素材-${Date.now()}`;

  await completePositioning(page);
  await confirmCandidateAndSaveTasks(page);
  await createMaterialForFlow(page, materialName);
  const { planUrl } = await createContentPlanAndSaveTasks(page, materialName);
  await confirmReviewMetricsAndSaveActions(page);

  const tasks = page.locator(".task-card");
  await expect(page.locator(".task-list")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看来源：定位报告" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "查看来源：创作方案" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "查看来源：复盘报告" }).first()).toBeVisible();
  const taskCountBeforeReload = await tasks.count();
  expect(taskCountBeforeReload).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: /^开始 / }).first().click();
  await expect(page.getByRole("status")).toContainText("任务已开始");
  await page.getByRole("button", { name: "选择任务" }).click();
  const taskCheckboxes = page.getByRole("checkbox", { name: /^选择 / });
  await taskCheckboxes.nth(0).check();
  await taskCheckboxes.nth(1).check();
  await page.getByRole("button", { name: "完成所选任务" }).click();
  await expect(page.getByRole("status")).toContainText("任务已完成");
  await expect(page.locator("body")).not.toContainText(/undefined|模拟进度|预计完成/);

  await page.reload();
  await page.goto("/tasks?range=all");
  await expect(page.locator(".task-card")).toHaveCount(taskCountBeforeReload);
  await page.goto("/me/profile");
  await expect(page.getByLabel("当前定位")).toHaveValue("产品学习复盘");
  await page.goto("/reports");
  await expect(page.getByText("定位报告").first()).toBeVisible();
  await expect(page.getByText("创作方案").first()).toBeVisible();
  await expect(page.getByText("复盘报告").first()).toBeVisible();
  const firstReport = page.locator(".report-card").first();
  const reportTitle = (await firstReport.locator("strong").innerText()).trim();
  await firstReport.locator(".report-card__main").click();
  const provenanceBeforeArchive = await page.locator(".report-version").first().innerText();
  await page.goto("/reports");
  await page.getByRole("button", { name: `归档${reportTitle}` }).click();
  await page.getByRole("link", { name: "已归档" }).click();
  await page.getByRole("button", { name: `恢复${reportTitle}` }).click();
  const restoredReport = page.locator(".report-card").filter({ hasText: reportTitle });
  await restoredReport.locator(".report-card__main").click();
  const provenanceAfterRestore = await page.locator(".report-version").first().innerText();
  expect(provenanceAfterRestore.replace(/\s+/g, " ").trim()).toBe(
    provenanceBeforeArchive.replace(/\s+/g, " ").trim(),
  );

  const projectId = planUrl.match(/\/creation\/([0-9a-f-]+)\/plan/)?.[1];
  expect(projectId).toBeTruthy();
  await page.goto(`/materials?q=${encodeURIComponent(materialName)}`);
  const materialRow = page.locator(".material-card").filter({ hasText: materialName });
  await expect(materialRow).toContainText("1 次关联");
  await materialRow.locator(".material-card__copy-link").click();
  await expect(page).toHaveURL(new RegExp(`/creation/${projectId}/materials$`));
  await expect(page.locator("body")).not.toContainText(/undefined|模拟进度|预计完成/);
});
