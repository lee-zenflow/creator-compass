# Creator Compass 数据与发布验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把真实周期指标、埋点、隐私、健康检查、完整 E2E 和发布验证接成最后一条可运行证据链。

**Architecture:** 埋点仍由服务端绑定 actor 和业务版本，前端不提交内部用户 ID。工作台指标从已确认 metric snapshot 聚合，缺数据返回明确空状态；发布闸门统一验证 Web、worker、数据库、对象存储和关键用户闭环。

**Tech Stack:** Next.js、PostgreSQL、Drizzle ORM、Vitest、Playwright、Docker Compose、MinIO、pg-boss。

## Global Constraints

- 指标只使用用户确认或平台授权数据；没有曝光时不估算，样本少于 3 条不做强历史结论。
- 周期仅支持 3、7、30 天；空数据展示破折号与补数入口，不填演示数字。
- 埋点不得包含邮件、原始访谈、原始 OCR、报告全文、API key 或内部 token。
- 游客注册合并必须在真实 PostgreSQL 事务中覆盖材料引用、报告版本、任务和设置。
- 发布必须通过 lint、typecheck、unit/integration、E2E、Next build、worker build 和健康检查。

---

## File Map

- `src/features/analytics/events.ts`：事件白名单与安全属性。
- `src/features/analytics/analytics-service.ts`：服务端事件写入。
- `src/features/workspace/workspace-service.ts`：3/7/30 天真实聚合。
- `src/server/health/health-service.ts`：Web、DB、worker、storage 检查。
- `tests/e2e/complete-product.spec.ts`：游客到注册的完整闭环。
- `scripts/verify-release.ps1`：Windows 一键发布验证。
- `docs/deployment.md`：可执行部署与恢复说明。

### Task 1: 埋点契约与安全属性

**Files:**
- Modify: `src/features/analytics/events.ts`
- Modify: `src/features/analytics/events.test.ts`
- Create: `src/features/analytics/analytics-service.ts`
- Create: `src/features/analytics/analytics-service.test.ts`

**Interfaces:**
- Produces: `trackProductEvent(actor, event)`，仅接受白名单事件与匿名化属性。

- [ ] **Step 1: 写失败测试，锁定五个核心转化事件与隐私拒绝**

```ts
test.each(["positioning_confirmed", "tasks_saved", "review_actions_saved", "task_completed", "data_acquisition_completed"])("accepts %s", async (eventName) => {
  await expect(trackProductEvent(actor, { eventName, flow: "creator_loop", entityVersion: 1, metadata: {} }, repository)).resolves.toBeDefined();
});

test("rejects private analytics properties", async () => {
  await expect(trackProductEvent(actor, { eventName: "tasks_saved", flow: "creator_loop", entityVersion: 1, metadata: { email: "a@example.com" } }, repository)).rejects.toThrow("PRIVATE_ANALYTICS_FIELD");
});
```

- [ ] **Step 2: 运行事件测试确认失败**

Run: `pnpm.cmd vitest run src/features/analytics`

Expected: FAIL。

- [ ] **Step 3: 实现白名单 schema 与敏感键拒绝**

```ts
const eventSchema = z.object({
  eventName: z.enum(["positioning_confirmed", "tasks_saved", "review_actions_saved", "task_completed", "data_acquisition_completed"]),
  flow: z.enum(["positioning", "creation", "review", "task", "creator_loop"]),
  entityVersion: z.number().int().positive(),
  metadata: z.record(z.string(), z.union([z.string().max(80), z.number(), z.boolean()])).default({}),
});
const forbiddenKeys = new Set(["email", "token", "secret", "transcript", "ocrrawtext", "body", "fullcontent", "apikey"]);
```

- [ ] **Step 4: 在服务层从 actor 派生归属，不接收表单 userId**

```ts
export async function trackProductEvent(actor: CurrentActor, input: ProductEventInput, repository = databaseAnalyticsRepository) {
  const event = eventSchema.parse(input);
  if (Object.keys(event.metadata).some((key) => forbiddenKeys.has(key.toLowerCase()))) throw new Error("PRIVATE_ANALYTICS_FIELD");
  return repository.insert({ ...actorWhere(actor), ...event });
}
```

Run: `pnpm.cmd vitest run src/features/analytics`

Expected: PASS。

- [ ] **Step 5: 提交埋点边界**

```powershell
git add src/features/analytics
git commit -m "feat: add privacy-safe product analytics"
```

### Task 2: 真实周期指标与结论门槛

**Files:**
- Modify: `src/features/workspace/workspace-service.ts`
- Modify: `src/features/workspace/workspace-service.test.ts`
- Modify: `src/features/reviews/calculate-metrics.ts`
- Modify: `src/features/reviews/calculate-metrics.test.ts`

**Interfaces:**
- Produces: `getWorkspaceView(actor, range: 3 | 7 | 30)`；数据不足时 `metrics: null` 与 `dataRequirement`。

- [ ] **Step 1: 写失败测试，拒绝估算曝光和小样本强结论**

```ts
test("does not fabricate exposure when platform has no exposure field", async () => {
  const view = await getWorkspaceView(actor, 7, repositoryWithoutExposure);
  expect(view.kind).toBe("activeUser");
  if (view.kind === "activeUser") expect(view.metrics?.views).toBeNull();
});

test("fewer than three posts produce a data requirement instead of a trend conclusion", async () => {
  const result = calculateReviewMetrics(twoConfirmedSnapshots);
  expect(result.historicalConclusion).toBeNull();
  expect(result.dataRequirement).toBe("至少需要 3 条已确认内容数据");
});
```

- [ ] **Step 2: 运行工作台与指标测试确认失败**

Run: `pnpm.cmd vitest run src/features/workspace src/features/reviews/calculate-metrics.test.ts`

Expected: FAIL。

- [ ] **Step 3: 严格限定周期和空值**

```ts
export const workspaceRangeSchema = z.union([z.literal(3), z.literal(7), z.literal(30)]);
export type WorkspaceMetrics = { views: number | null; interactionRate: number | null; followerConversionRate: number | null };
```

- [ ] **Step 4: 仅聚合 `userConfirmedAt IS NOT NULL` 快照**

```ts
const confirmedRows = await database.select().from(metricSnapshots).where(and(actorCondition(actor, metricSnapshots), isNotNull(metricSnapshots.userConfirmedAt), gte(metricSnapshots.publishedAt, rangeStart)));
```

Run: `pnpm.cmd vitest run src/features/workspace src/features/reviews/calculate-metrics.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交真实指标逻辑**

```powershell
git add src/features/workspace src/features/reviews/calculate-metrics*
git commit -m "feat: enforce evidence-based workspace metrics"
```

### Task 3: 核心动作接入埋点且不影响业务事务

**Files:**
- Modify: `src/features/positioning/positioning-actions.ts`
- Modify: `src/features/positioning/positioning-actions.test.ts`
- Modify: `src/features/tasks/task-actions.ts`
- Modify: `src/features/tasks/task-service.test.ts`
- Modify: `src/features/reviews/review-actions.ts`
- Modify: `src/features/reviews/review-service.test.ts`

**Interfaces:**
- Consumes: `trackProductEvent`。
- Produces: 定位确认、任务保存、复盘行动和任务完成事件。

- [ ] **Step 1: 写失败测试，业务成功后写事件，业务失败不写**

```ts
test("tracks positioning only after confirmation succeeds", async () => {
  confirmMock.mockResolvedValue(confirmedResult);
  await confirmPositioningIntent(form);
  expect(trackMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventName: "positioning_confirmed", entityVersion: confirmedResult.reportVersion }));
});
```

- [ ] **Step 2: 运行三组 action/service 测试确认失败**

Run: `pnpm.cmd vitest run src/features/positioning/positioning-actions.test.ts src/features/tasks src/features/reviews`

Expected: FAIL。

- [ ] **Step 3: 在业务写入成功后调用事件服务，事件失败只记安全日志**

```ts
const result = await confirmPositioningCandidate(actor, input);
await trackProductEvent(actor, { eventName: "positioning_confirmed", flow: "positioning", entityVersion: result.reportVersion, metadata: {} }).catch(logSafeAnalyticsFailure);
return result;
```

- [ ] **Step 4: 跑相关服务测试**

Run: `pnpm.cmd vitest run src/features/positioning src/features/tasks src/features/reviews src/features/analytics`

Expected: PASS，埋点失败不回滚已经完成的用户操作。

- [ ] **Step 5: 提交动作埋点**

```powershell
git add src/features/positioning src/features/tasks src/features/reviews
git commit -m "feat: connect creator loop analytics"
```

### Task 4: 健康检查与发布脚本

**Files:**
- Modify: `src/server/health/health-service.ts`
- Modify: `src/server/health/health-service.test.ts`
- Modify: `src/server/health/deployment-contract.test.ts`
- Create: `scripts/verify-release.ps1`
- Modify: `docs/deployment.md`

**Interfaces:**
- Produces: `/api/health/web|database|worker|storage` 的安全状态；一键发布验证脚本。

- [ ] **Step 1: 写失败测试，要求四组件独立状态且不泄漏连接信息**

```ts
test("health response contains only safe component status", async () => {
  const result = await getHealthStatus(fakeDependencies);
  expect(result.components).toEqual({ web: "ok", database: "ok", worker: "ok", storage: "ok" });
  expect(JSON.stringify(result)).not.toMatch(/postgres:|password|secret|bucketKey/i);
});
```

- [ ] **Step 2: 运行健康检查测试确认失败**

Run: `pnpm.cmd vitest run src/server/health`

Expected: FAIL。

- [ ] **Step 3: 增加 worker 心跳与 storage HEAD 检查**

```ts
export type ComponentHealth = "ok" | "degraded" | "down";
export type HealthStatus = { status: ComponentHealth; checkedAt: string; components: Record<"web" | "database" | "worker" | "storage", ComponentHealth> };
```

- [ ] **Step 4: 创建 Windows 发布验证脚本**

```powershell
$ErrorActionPreference = 'Stop'
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd e2e
pnpm.cmd build
pnpm.cmd build:worker
Write-Host 'Creator Compass release verification passed.'
```

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1`

Expected: 所有命令 exit 0。

- [ ] **Step 5: 提交健康与发布脚本**

```powershell
git add src/server/health scripts/verify-release.ps1 docs/deployment.md
git commit -m "ops: add complete release health gate"
```

### Task 5: 完整用户闭环 E2E

**Files:**
- Create: `tests/e2e/complete-product.spec.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/positioning.spec.ts`
- Modify: `tests/e2e/creation.spec.ts`
- Modify: `tests/e2e/review.spec.ts`

**Interfaces:**
- Consumes: 手机前台、AI test adapter、任务与注册合并。
- Produces: 游客 → 定位 → 创作 → 复盘 → 任务 → 注册合并的真实测试证据。

- [ ] **Step 1: 写完整闭环失败测试**

```ts
test("guest completes the creator loop and keeps data after registration", async ({ page }) => {
  await startGuest(page);
  const positioning = await completePositioning(page);
  await confirmCandidateAndSaveTasks(page, positioning);
  await createContentPlanAndSaveTasks(page);
  await confirmReviewMetricsAndSaveActions(page);
  const taskCount = await page.getByTestId("task-card").count();
  await registerCurrentGuest(page);
  await expect(page.getByTestId("task-card")).toHaveCount(taskCount);
  await expect(page.getByText("个人 IP 档案")).toBeVisible();
});
```

- [ ] **Step 2: 在 E2E 数据库运行并确认当前缺口**

Run: `$env:E2E_DATABASE_URL=$env:TEST_DATABASE_URL; pnpm.cmd e2e -- tests/e2e/complete-product.spec.ts`

Expected: 首次 FAIL，并给出具体断点。

- [ ] **Step 3: 只修复测试暴露的真实跨模块断点**

```ts
await expect(page.getByRole("status")).not.toContainText(/模拟|预计|假数据/);
await expect(page.locator("body")).not.toContainText("undefined");
```

- [ ] **Step 4: 跑全 E2E**

Run: `$env:E2E_DATABASE_URL=$env:TEST_DATABASE_URL; pnpm.cmd e2e`

Expected: 全部 PASS，失败保留 trace/screenshot/video。

- [ ] **Step 5: 提交完整闭环测试**

```powershell
git add tests/e2e
git commit -m "test: verify the complete creator decision loop"
```

### Task 6: 最终发布验收与文档收口

**Files:**
- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `docs/backup-restore.md`
- Modify: `docs/ai-operations.md`

**Interfaces:**
- Produces: 新环境可复现的启动、迁移、seed、worker、知识入库、备份与恢复说明。

- [ ] **Step 1: 用部署合同测试锁定必需命令与环境变量名称**

```ts
test("deployment docs include every runnable service", () => {
  const docs = readFileSync("docs/deployment.md", "utf8");
  for (const command of ["pnpm db:migrate", "pnpm db:seed", "pnpm worker", "pnpm build", "pnpm build:worker"]) expect(docs).toContain(command);
  for (const name of ["DATABASE_URL", "AUTH_SECRET", "DEEPSEEK_API_KEY", "S3_ENDPOINT", "S3_BUCKET"]) expect(docs).toContain(name);
});
```

- [ ] **Step 2: 运行部署合同测试确认文档缺口**

Run: `pnpm.cmd vitest run src/server/health/deployment-contract.test.ts`

Expected: 缺少项时 FAIL。

- [ ] **Step 3: 补齐可复制执行的部署、知识运营和恢复步骤**

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd build
pnpm.cmd build:worker
pnpm.cmd start
pnpm.cmd worker
```

- [ ] **Step 4: 执行最终证据门槛**

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1`

Expected: lint、typecheck、unit/integration、E2E、Next build、worker build 全部 exit 0。

- [ ] **Step 5: 检查工作树并提交发布文档**

```powershell
git diff --check
git status --short
git add README.md docs
git commit -m "docs: finalize complete product operations"
```
