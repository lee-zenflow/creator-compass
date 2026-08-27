import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import {
  completePositioning,
  confirmCandidateAndSaveTasks,
  createContentPlanAndSaveTasks,
  requireE2eInfrastructure,
  startLocalOwnerSession,
} from "./helpers";

test.setTimeout(120_000);

test("工作台始终只给出一个真实下一步，刷新后仍可继续", async ({ page }) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);

  const currentStep = page.getByTestId("current-step");
  await expect(currentStep).toHaveCount(1);
  const target = await currentStep.getByRole("link").getAttribute("href");
  expect(target).toMatch(/^\/(me\/profile|positioning|creation|tasks|reviews)/);

  await currentStep.getByRole("link").click();
  await page.reload();
  await expect(page.locator("main")).not.toContainText(/undefined|模拟进度|预计完成/);
});

test("创作生成失败后保留旧方案，并把同一次重试只写入一个新任务", async ({ page }) => {
  requireE2eInfrastructure();
  await startLocalOwnerSession(page);
  await completePositioning(page);
  await confirmCandidateAndSaveTasks(page);
  const { planUrl } = await createContentPlanAndSaveTasks(page);

  const runId = new URL(planUrl).searchParams.get("run");
  const projectId = planUrl.match(/\/creation\/([0-9a-f-]+)\/plan/)?.[1];
  expect(runId).toBeTruthy();
  expect(projectId).toBeTruthy();

  const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
  try {
    await pool.query(
      `update ai_runs set status = 'failed', error_code = 'TIMEOUT', safe_error_detail = 'AI generation timed out.', updated_at = now() where id = $1`,
      [runId],
    );
    const before = await pool.query<{ count: string }>(
      `select count(*)::text as count from ai_runs where creation_project_id = $1`,
      [projectId],
    );

    await page.goto(planUrl);
    await expect(page.locator('.status-row[role="alert"]')).toContainText("生成超时");
    await expect(page.getByRole("link", { name: "预览执行任务" })).toBeVisible();
    await page.getByRole("button", { name: "重新生成" }).click();

    await expect.poll(async () => {
      const result = await pool.query<{ count: string }>(
        `select count(*)::text as count from ai_runs where creation_project_id = $1`,
        [projectId],
      );
      return Number(result.rows[0]?.count ?? 0);
    }).toBe(Number(before.rows[0]?.count ?? 0) + 1);
    await expect(page.locator("body")).not.toContainText(/postgres|stack|deepseek raw/i);
  } finally {
    await pool.end();
  }
});
