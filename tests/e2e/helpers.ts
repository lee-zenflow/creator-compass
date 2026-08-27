import { expect, test, type Page } from "@playwright/test";

export const e2eEnabled = Boolean(process.env.E2E_DATABASE_URL);

export function requireE2eInfrastructure() {
  test.skip(!e2eEnabled, "需要 E2E_DATABASE_URL、已迁移数据库、MinIO 和 Mailpit。没有这些依赖时不伪造通过。");
}

const LOCAL_OWNER = {
  username: "E2E Owner",
  password: "E2e-local-owner-2026",
} as const;

let sessionSequence = 0;

export async function startLocalOwnerSession(page: Page) {
  sessionSequence += 1;
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": `198.51.100.${sessionSequence}`,
  });
  await page.goto("/");
  if (/\/setup$/.test(page.url())) {
    await page.getByLabel("用户名").fill(LOCAL_OWNER.username);
    await page.getByLabel("密码").fill(LOCAL_OWNER.password);
    await page.getByRole("button", { name: "创建本地 Owner" }).click();
    await expect(page.getByRole("list", { name: "一次性恢复码" })).toBeVisible();
    await page.getByRole("link", { name: "我已保存，去登录" }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  if (/\/login$/.test(page.url())) {
    await page.getByLabel("用户名").fill(LOCAL_OWNER.username);
    await page.getByLabel("密码").fill(LOCAL_OWNER.password);
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page).toHaveURL(/\/workspace$/);
  await page.reload();
  await expect(page).toHaveURL(/\/workspace$/);
}

export async function completePositioning(page: Page) {
  await page.goto("/positioning");
  await page.getByRole("button", { name: "新建定位" }).click();
  await expect(page).toHaveURL(/\/positioning\/[0-9a-f-]+$/);
  await page.getByLabel("输入你的回答").fill("我是一名产品经理，想用真实的 AI 产品实践帮助个人创作者提升效率，每周可投入 6 小时。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100", { timeout: 30_000 });
  await page.reload();
  await page.getByRole("button", { name: "生成报告" }).click();
  await expect(page.getByRole("link", { name: "查看候选方案" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "查看候选方案" }).click();
  await expect(page.getByText("为你生成 3 个定位方向")).toBeVisible();
}

export async function confirmCandidateAndSaveTasks(page: Page) {
  await page.getByRole("link", { name: "查看详情 ›" }).first().click();
  await page.getByRole("button", { name: "确认方向" }).click();
  await expect(page.getByText("定位已写入创作档案")).toBeVisible();
  await page.getByRole("button", { name: "写入任务中心" }).click();
  await expect(page).toHaveURL(/\/tasks/);
}

export async function createContentPlanAndSaveTasks(page: Page, materialName?: string) {
  await page.goto("/creation/new");
  await page.getByLabel("本轮创作目标").fill("把一次真实的 AI 产品实践整理成可发布图文");
  await page.getByLabel("补充要求").fill("不虚构数据，不引用未审核案例");
  await page.getByRole("button", { name: "选择参考素材" }).click();
  if (materialName) {
    await page.getByRole("checkbox", { name: new RegExp(materialName) }).check();
  }
  await page.getByRole("button", { name: "生成内容方案" }).click();
  await expect(page.getByRole("link", { name: "预览执行任务" })).toBeVisible({ timeout: 30_000 });
  const planUrl = page.url();
  await page.getByRole("link", { name: "预览执行任务" }).click();
  await page.getByRole("button", { name: "写入任务中心" }).click();
  await expect(page).toHaveURL(/\/tasks/);
  return { planUrl };
}

export async function createMaterialForFlow(page: Page, name: string) {
  await page.goto("/materials?new=1");
  await page.getByLabel("名称").fill(name);
  await page.getByLabel("来源").fill("E2E 公开流程");
  await page.getByLabel("摘要").fill("用于验证素材、创作和报告之间的真实关联");
  await page.getByRole("button", { name: "保存素材" }).click();
  await expect(page.getByRole("region", { name: "素材列表" })).toContainText(name);
}

function yesterdayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 86_400_000));
}

export async function makeFirstTaskOverdueThroughUi(page: Page) {
  await page.goto("/tasks?range=all");
  const pendingTask = page.locator(".task-card").filter({
    has: page.getByRole("button", { name: /^开始 / }),
  }).first();
  const taskHref = await pendingTask.locator(".task-card__detail-link").getAttribute("href");
  expect(taskHref).toMatch(/^\/tasks\/[0-9a-f-]+$/);
  await pendingTask.locator(".task-card__detail-link").click();
  await page.getByRole("link", { name: "编辑" }).click();
  await page.getByLabel("计划日期").fill(yesterdayInShanghai());
  await page.getByRole("button", { name: "保存调整" }).click();
  await page.goto("/tasks?range=all");
  const updatedTask = page.locator(".task-card").filter({
    has: page.locator(`.task-card__detail-link[href="${taskHref}"]`),
  });
  await expect(updatedTask).toContainText("已逾期");
}

export async function createPlatformAccount(page: Page) {
  await page.goto("/me/platforms");
  await page.getByLabel("账号标签").fill("E2E 主账号");
  await page.getByRole("button", { name: "添加账号标签" }).click();
  await expect(page.getByText("E2E 主账号")).toBeVisible();
}

export async function confirmReviewMetricsAndSaveActions(page: Page) {
  await createPlatformAccount(page);
  await page.goto("/reviews/new");
  await page.getByLabel("内容标题").fill("产品学习复盘");
  await page.getByLabel("发布时间").fill("2026-08-09T10:00:00+08:00");
  await page.getByLabel("播放/阅读量").fill("100");
  await page.getByLabel("点赞").fill("8");
  await page.getByRole("button", { name: "确认并生成复盘" }).click();
  await expect(page.getByRole("link", { name: "预览任务" })).toBeVisible({ timeout: 30_000 });
  const reportUrl = page.url();
  await page.getByRole("link", { name: "预览任务" }).click();
  await page.getByRole("button", { name: "写入任务中心" }).click();
  await expect(page).toHaveURL(/\/tasks/);
  return { reportUrl };
}

export async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
}
