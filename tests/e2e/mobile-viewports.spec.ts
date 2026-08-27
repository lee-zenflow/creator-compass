import { expect, test, type Page } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  completePositioning,
  confirmCandidateAndSaveTasks,
  createContentPlanAndSaveTasks,
  createMaterialForFlow,
  makeFirstTaskOverdueThroughUi,
  requireE2eInfrastructure,
  startLocalOwnerSession,
} from "./helpers";

const MOBILE_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
] as const;

async function expectMobileBoard(page: Page, viewport: { width: number; height: number }) {
  await expect(page.locator(".compact-skeleton")).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("overflow-x", "hidden");
  await assertNoHorizontalOverflow(page);

  const board = page.locator(".app-shell");
  await expect(board).toHaveCount(1);
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(Math.min(viewport.width, 390));
  expect(Math.round(box!.height)).toBe(viewport.height);

  const contentFits = await page.locator(".app-content").evaluate((element) =>
    element.scrollWidth <= element.clientWidth,
  );
  expect(contentFits).toBe(true);
}

async function expectMinimumTouchTargets(locator: ReturnType<Page["locator"]>) {
  const targets = await locator.all();
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    if (!(await target.isVisible()) || !(await target.isEnabled())) continue;
    const box = await target.boundingBox();
    expect(box, "visible interactive target has a layout box").not.toBeNull();
    expect(box!.width, "interactive target width").toBeGreaterThanOrEqual(42);
    expect(box!.height, "interactive target height").toBeGreaterThanOrEqual(42);
  }
}

async function expectBottomNavigationVisible(page: Page, viewport: { height: number }) {
  const nav = page.getByRole("navigation", { name: "主导航" });
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(box!.y).toBeGreaterThan(viewport.height - 70);
}

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height} 手机画板`, () => {
    test.use({ viewport });

    test("工作台到任务、素材和报告形成紧凑移动闭环", async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      requireE2eInfrastructure();
      await startLocalOwnerSession(page);
      const materialName = `移动闭环素材-${viewport.width}`;

      await page.goto("/workspace");
      await expectMobileBoard(page, viewport);
      await expectBottomNavigationVisible(page, viewport);
      await testInfo.attach("workspace", { body: await page.screenshot(), contentType: "image/png" });

      await page.goto("/tools");
      await expectMobileBoard(page, viewport);
      await expectBottomNavigationVisible(page, viewport);
      const toolRows = page.getByTestId("tool-entry");
      await expect(toolRows).toHaveCount(5);
      for (const row of await toolRows.all()) {
        expect((await row.boundingBox())?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(72);
      }
      await testInfo.attach("tools", { body: await page.screenshot(), contentType: "image/png" });

      await completePositioning(page);
      await expectMobileBoard(page, viewport);
      const candidates = page.locator(".candidate-card");
      await expect(candidates).toHaveCount(3);
      for (const candidate of await candidates.all()) {
        const box = await candidate.boundingBox();
        expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(Math.min(viewport.width, 390) - 30);
        expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(190);
      }
      await testInfo.attach("positioning-candidates", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

      await confirmCandidateAndSaveTasks(page);
      await createMaterialForFlow(page, materialName);
      await createContentPlanAndSaveTasks(page, materialName);
      await makeFirstTaskOverdueThroughUi(page);

      await expectMobileBoard(page, viewport);
      await expect(page.getByRole("navigation", { name: "任务日期筛选" })).toBeVisible();
      await expect(page.getByText("已逾期").first()).toBeVisible();
      const taskRows = page.locator(".task-card");
      expect(await taskRows.count()).toBeGreaterThanOrEqual(2);
      expect(Math.round((await taskRows.first().boundingBox())!.height)).toBe(84);
      await expectMinimumTouchTargets(taskRows.first().locator("a, button"));

      await page.getByRole("button", { name: /^开始 / }).first().click();
      await expect(page.getByRole("status")).toContainText("任务已开始");
      await page.getByRole("button", { name: "选择任务" }).click();
      const unfinishedTasks = page.locator(".task-card").filter({ hasText: /待开始|进行中/ });
      expect(await unfinishedTasks.count()).toBeGreaterThanOrEqual(2);
      await unfinishedTasks.nth(0).getByRole("checkbox", { name: /^选择 / }).check();
      await unfinishedTasks.nth(1).getByRole("checkbox", { name: /^选择 / }).check();
      await page.getByRole("button", { name: "完成所选任务" }).click();
      await expect(page.getByRole("status")).toContainText("任务已完成");

      await page.goto(`/materials?q=${encodeURIComponent(materialName)}`);
      await expectMobileBoard(page, viewport);
      const materialRow = page.locator(".material-card").filter({ hasText: materialName });
      await expect(materialRow).toHaveCount(1);
      expect(Math.round((await materialRow.boundingBox())!.height)).toBe(64);
      await expectMinimumTouchTargets(materialRow.locator("a, button"));
      await materialRow.locator(".material-card__copy-link").click();
      await expect(page).toHaveURL(/\/creation\/[0-9a-f-]+\/materials$/);

      await page.goto("/reports");
      await expectMobileBoard(page, viewport);
      const firstReport = page.locator(".report-card").first();
      const reportTitle = (await firstReport.locator("strong").innerText()).trim();
      const reportHref = await firstReport.locator(".report-card__main").getAttribute("href");
      const reportId = reportHref ? new URL(reportHref, "http://localhost").searchParams.get("report") : null;
      expect(reportId).toMatch(/^[0-9a-f-]+$/);
      expect(Math.round((await firstReport.boundingBox())!.height)).toBe(64);
      await expectMinimumTouchTargets(firstReport.locator("a, button"));
      await firstReport.getByRole("button", { name: `归档${reportTitle}` }).click();
      await expect(page.getByRole("status")).toContainText("报告已归档");
      await page.getByRole("link", { name: "已归档" }).click();
      const archivedReport = page.locator(".report-card").filter({
        has: page.locator(`.report-card__main[href*="report=${reportId}"]`),
      });
      await archivedReport.getByRole("button", { name: `恢复${reportTitle}` }).click();
      await expect(page.getByRole("status")).toContainText("报告已恢复");
      const restoredReport = page.locator(".report-card").filter({
        has: page.locator(`.report-card__main[href*="report=${reportId}"]`),
      });
      await restoredReport.locator(".report-card__main").click();
      await expect(page.getByRole("heading", { name: "版本记录" })).toBeVisible();
      await expect(page.getByText("生成方式").first()).toBeVisible();
    });
  });
}
