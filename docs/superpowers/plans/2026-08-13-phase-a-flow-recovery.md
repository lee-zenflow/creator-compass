# Creator Compass A 阶段：流程承接与失败恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户每次进入产品都能看到唯一的下一步，并能从定位、创作、任务、复盘任一失败或中断状态继续完成真实业务链路。

**Architecture:** 新增一个只读取现有业务聚合根的 `NextActionService`，不创建第二套状态机；工作台只消费其结果。AI 错误统一映射为可恢复视图模型，重试继续使用现有幂等键与已保存输入，任务和报告通过现有 `reportId/version/sourceType` 建立可追溯跳转。

**Tech Stack:** Next.js 16、React 19、TypeScript、Drizzle ORM、PostgreSQL、Zod、Vitest、Testing Library、Playwright。

## Global Constraints

- 不新增业务状态表，不复制定位、创作、复盘或任务状态。
- 下一步必须由当前 actor 的真实数据库状态推导，跨用户数据始终不可见。
- 同一输入重试复用已有 active run；输入已变化时返回明确冲突，不静默复用旧结果。
- `NOT_CONFIGURED`、`TIMEOUT`、`RATE_LIMITED`、`AI_INPUT_CHANGED`、结构化输出失败、队列失败必须使用固定安全码，页面不显示内部错误。
- 所有跳转都必须指向现有路由，并携带真实 `reportId`、`version`、`candidateId` 或 `taskId`。
- 继续沿用 390×844 紧凑移动端，不增加大型模块。

---

## File Map

- `src/features/workspace/next-action-service.ts`：读取现有聚合状态并按唯一优先级返回下一步。
- `src/features/workspace/current-step-row.tsx`：64–72px 的唯一当前步骤展示。
- `src/features/ai/recovery-contract.ts`：安全错误码、展示文案和可重试性映射。
- `src/features/tasks/task-source-link.ts`：任务来源到真实业务详情路由的唯一映射。
- `src/features/*/*-actions.ts`：已有输入的安全重试入口。
- `tests/e2e/flow-recovery.spec.ts`：刷新、失败、重试和跨模块承接。

### Task 1: 建立纯 NextAction 优先级模型

**Files:**
- Create: `src/features/workspace/next-action-service.ts`
- Create: `src/features/workspace/next-action-service.test.ts`

**Interfaces:**
- Produces: `NextActionStage`、`NextAction`、`NextActionFacts`、`resolveNextAction(facts)`。

- [ ] **Step 1: 写表驱动失败测试**

```ts
import { describe, expect, test } from "vitest";
import { resolveNextAction, type NextActionFacts } from "./next-action-service";

const base: NextActionFacts = {
  hasProfile: true, hasPositioning: true, interviewIncomplete: false,
  failedRun: null, unconfirmedPositioning: null, confirmedPositioning: null,
  creationProject: null, unsavedTaskSource: null, highestPriorityTask: null,
  publishedWithoutReview: null, reviewActionTask: null,
};

describe("resolveNextAction", () => {
  test.each([
    [{ ...base, hasProfile: false }, "profile", "/me/profile"],
    [{ ...base, hasPositioning: false }, "positioning", "/positioning"],
    [{ ...base, interviewIncomplete: true }, "positioning", "/positioning/session-1"],
    [{ ...base, failedRun: { taskType: "positioning_report", href: "/positioning/session-1" } }, "positioning", "/positioning/session-1"],
    [{ ...base, unconfirmedPositioning: { href: "/positioning/session-1/report" } }, "positioning", "/positioning/session-1/report"],
    [{ ...base, highestPriorityTask: { id: "task-1", title: "完成脚本" } }, "task", "/tasks/task-1"],
  ] as const)("selects one highest-priority action", (facts, stage, href) => {
    expect(resolveNextAction(facts)).toMatchObject({ stage, href });
  });
});
```

- [ ] **Step 2: 运行并确认缺少模块**

Run: `pnpm.cmd vitest run src/features/workspace/next-action-service.test.ts`

Expected: FAIL，提示无法解析 `next-action-service`。

- [ ] **Step 3: 实现固定类型和单一优先级函数**

```ts
export type NextActionStage = "profile" | "positioning" | "creation" | "task" | "review";
export type NextAction = {
  stage: NextActionStage;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  source?: { type: "positioning" | "creation" | "review"; id: string; version: number };
};

export function resolveNextAction(facts: NextActionFacts): NextAction {
  if (!facts.hasProfile) return action("profile", "完善创作档案", "先补齐你的创作条件", "/me/profile", "去完善");
  if (!facts.hasPositioning) return action("positioning", "确定内容方向", "通过访谈生成候选定位", "/positioning", "开始定位");
  if (facts.interviewIncomplete) return action("positioning", "继续定位访谈", "回答未完成的问题", facts.interviewHref!, "继续访谈");
  if (facts.failedRun) return action(stageFor(facts.failedRun.taskType), "上次生成未完成", "已保留输入，可以安全重试", facts.failedRun.href, "重新生成");
  if (facts.unconfirmedPositioning) return action("positioning", "确认一个定位方向", "查看三套候选并选择", facts.unconfirmedPositioning.href, "查看候选");
  if (facts.confirmedPositioning && !facts.creationProject) return action("creation", "开始第一次创作", "使用已确认定位生成内容方案", "/creation/new", "开始创作");
  if (facts.unsavedTaskSource) return { ...action("task", "确认行动任务", "选择任务并写入任务中心", facts.unsavedTaskSource.href, "预览任务"), source: facts.unsavedTaskSource.source };
  if (facts.highestPriorityTask) return action("task", facts.highestPriorityTask.title, "执行当前最高优先级任务", `/tasks/${facts.highestPriorityTask.id}`, "查看任务");
  if (facts.publishedWithoutReview) return action("review", "复盘已发布内容", "补充真实数据并生成判断", `/reviews/new?source=${facts.publishedWithoutReview.id}`, "开始复盘");
  if (facts.reviewActionTask) return action("task", facts.reviewActionTask.title, "执行复盘后的改进任务", `/tasks/${facts.reviewActionTask.id}`, "开始执行");
  return action("creation", "开始下一轮创作", "基于最近结论继续行动", "/creation/new", "新建创作");
}
```

- [ ] **Step 4: 跑测试并提交纯模型**

Run: `pnpm.cmd vitest run src/features/workspace/next-action-service.test.ts`

Expected: PASS。

```powershell
git add src/features/workspace/next-action-service.ts src/features/workspace/next-action-service.test.ts
git commit -m "feat: resolve the next creator action"
```

### Task 2: 从真实数据库组装 NextActionFacts

**Files:**
- Modify: `src/features/workspace/workspace-service.ts`
- Modify: `src/features/workspace/workspace-service.test.ts`

**Interfaces:**
- Consumes: `resolveNextAction(facts)`。
- Produces: `WorkspaceViewModel.nextAction: NextAction`。

- [ ] **Step 1: 扩展仓储合同和 owner-safe 测试**

```ts
test("builds next action from actor-owned aggregate facts", async () => {
  const repository = fakeWorkspaceRepository({
    journey: { hasProfile: true, hasPositioning: true, interviewIncomplete: false,
      failedRun: null, unconfirmedPositioning: { href: "/positioning/s1/report" },
      confirmedPositioning: null, creationProject: null, unsavedTaskSource: null,
      highestPriorityTask: null, publishedWithoutReview: null, reviewActionTask: null },
  });
  const view = await getWorkspace(actor, 7, repository, now);
  expect(view.nextAction).toMatchObject({ stage: "positioning", href: "/positioning/s1/report" });
});
```

- [ ] **Step 2: 运行并确认 `nextAction` 缺失**

Run: `pnpm.cmd vitest run src/features/workspace/workspace-service.test.ts`

Expected: FAIL，`nextAction` 为 `undefined`。

- [ ] **Step 3: 新增一次 actor-scoped journey 查询并组装结果**

```ts
export interface WorkspaceRepository {
  // existing methods stay unchanged
  getJourneyFacts(actor: CurrentActor): Promise<NextActionFacts>;
}

const journey = await repository.getJourneyFacts(actor);
return {
  ...existingView,
  nextAction: resolveNextAction(journey),
};
```

数据库实现必须对 `creatorProfiles`、`positioningSessions`、`aiRuns`、`positioningReports`、`creationProjects`、`contentPlans`、`reviews`、`reviewReports`、`tasks` 分别使用现有 `actorWhere()`，只返回优先级判断所需字段，不复制报告正文。

- [ ] **Step 4: 运行测试并提交读模型**

Run: `pnpm.cmd vitest run src/features/workspace/workspace-service.test.ts src/features/workspace/next-action-service.test.ts`

Expected: PASS。

```powershell
git add src/features/workspace/workspace-service.ts src/features/workspace/workspace-service.test.ts
git commit -m "feat: derive workspace journey state"
```

### Task 3: 在工作台显示唯一当前步骤行

**Files:**
- Create: `src/features/workspace/current-step-row.tsx`
- Create: `src/features/workspace/current-step-row.test.tsx`
- Modify: `src/features/workspace/workspace-view.tsx`
- Modify: `src/features/workspace/workspace-view.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `NextAction`。
- Produces: `CurrentStepRow({ action })`。

- [ ] **Step 1: 写 64–72px、唯一 CTA 的失败测试**

```tsx
render(<CurrentStepRow action={{ stage: "task", title: "完成脚本", detail: "今天优先处理", href: "/tasks/1", actionLabel: "查看任务" }} />);
expect(screen.getByRole("link", { name: "查看任务" })).toHaveAttribute("href", "/tasks/1");
expect(screen.getByTestId("current-step")).toHaveAttribute("data-stage", "task");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/workspace/current-step-row.test.tsx src/features/workspace/workspace-view.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现紧凑行并放在账号切换下方**

```tsx
export function CurrentStepRow({ action }: { action: NextAction }) {
  return <section className="current-step-row" data-stage={action.stage} data-testid="current-step">
    <ModuleIcon name={stageIcon[action.stage]} label={action.title} />
    <span><small>当前步骤</small><strong>{action.title}</strong><em>{action.detail}</em></span>
    <Link href={action.href}>{action.actionLabel}</Link>
  </section>;
}
```

其中映射固定为：

```ts
const stageIcon = { profile:"profile", positioning:"positioning", creation:"creation", task:"tasks", review:"review" } as const;
```

```css
.current-step-row { min-height: 68px; display: grid; grid-template-columns: 32px minmax(0,1fr) auto; align-items: center; gap: 10px; border-block: 1px solid var(--cc-line); }
.current-step-row span { min-width: 0; display: grid; gap: 2px; }
.current-step-row em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: normal; color: var(--cc-muted); }
```

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/workspace/current-step-row.test.tsx src/features/workspace/workspace-view.test.tsx src/features/workspace/workspace-visual-contract.test.ts`

Expected: PASS，且页面只出现一个主操作。

```powershell
git add src/features/workspace/current-step-row.tsx src/features/workspace/current-step-row.test.tsx src/features/workspace/workspace-view.tsx src/features/workspace/workspace-view.test.tsx src/app/globals.css
git commit -m "feat: show the current creator step"
```

### Task 4: 统一任务来源与回跳路由

**Files:**
- Create: `src/features/tasks/task-source-link.ts`
- Create: `src/features/tasks/task-source-link.test.ts`
- Modify: `src/app/(product)/tasks/[id]/page.tsx`
- Modify: `src/features/tasks/task-card.tsx`
- Modify: `src/features/tasks/task-service.ts`
- Modify: `src/features/tasks/task-service.test.ts`
- Modify: `src/app/(product)/positioning/[sessionId]/report/[candidateId]/page.tsx`
- Modify: `src/app/(product)/creation/[projectId]/plan/page.tsx`
- Modify: `src/app/(product)/reviews/[reviewId]/report/page.tsx`

**Interfaces:**
- Produces: `TaskSourceLinkInput`、`taskSourceHref(source): string`；`TaskSourceSnapshot.typedVersion.entityId` 对新任务持久化真实业务根 ID，旧任务允许缺失并回退报告记录页。

- [ ] **Step 1: 写三类来源映射测试**

```ts
expect(taskSourceHref({ type: "positioning", entityId: "s1", reportId: "r1", version: 2 })).toBe("/positioning/s1/report?report=r1&version=2");
expect(taskSourceHref({ type: "creation", entityId: "p1", reportId: "r2", version: 3 })).toBe("/creation/p1/plan?report=r2&version=3");
expect(taskSourceHref({ type: "review", entityId: "v1", reportId: "r3", version: 1 })).toBe("/reviews/v1/report?report=r3&version=1");
expect(taskSourceHref({ type: "review", entityId: null, reportId: "r3", version: 1 })).toBe("/reports?report=r3");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/tasks/task-source-link.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现唯一映射并在详情展示来源、版本和为什么做**

```ts
export type TaskSourceLinkInput = { type: ReportType; entityId: string | null; reportId: string; version: number };
export function taskSourceHref(source: TaskSourceLinkInput) {
  if (!source.entityId) return `/reports?report=${source.reportId}`;
  const query = `report=${source.reportId}&version=${source.version}`;
  if (source.type === "positioning") return `/positioning/${source.entityId}/report?${query}`;
  if (source.type === "creation") return `/creation/${source.entityId}/plan?${query}`;
  return `/reviews/${source.entityId}/report?${query}`;
}
```

`findReportVersion()` 同时选择 `positioningSessionId`、`creationProjectId` 或 `reviewId`，写入 `sourceSnapshot.typedVersion.entityId`；`TaskSourceSnapshot` 将该字段定义为 `string | null`，兼容历史任务。任务详情新增“来源模块 / 报告版本 / 为什么做”三行；没有来源时明确显示“手动创建”，不能猜测业务来源。

三个报告详情继续使用现有真实业务路由，并各自保留唯一的“预览任务”入口：定位 `/positioning/{sessionId}/tasks`、创作 `/creation/{projectId}/tasks`、复盘 `/reviews/{reviewId}/tasks`。测试必须逐一点击并确认不是 404。

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/tasks/task-source-link.test.ts src/features/tasks/task-service.test.ts src/features/tasks/task-actions.test.ts`

Expected: PASS。

```powershell
git add src/features/tasks/task-source-link.ts src/features/tasks/task-source-link.test.ts 'src/app/(product)/tasks/[id]/page.tsx' src/features/tasks/task-card.tsx src/features/tasks/task-service.ts src/features/tasks/task-service.test.ts 'src/app/(product)/positioning/[sessionId]/report/[candidateId]/page.tsx' 'src/app/(product)/creation/[projectId]/plan/page.tsx' 'src/app/(product)/reviews/[reviewId]/report/page.tsx'
git commit -m "feat: link tasks to their source reports"
```

### Task 5: 统一安全错误与恢复动作

**Files:**
- Create: `src/features/ai/recovery-contract.ts`
- Create: `src/features/ai/recovery-contract.test.ts`
- Create: `src/components/ui/recovery-action.tsx`
- Create: `src/components/ui/recovery-action.test.tsx`
- Modify: `src/features/positioning/positioning-actions.ts`
- Modify: `src/features/creation/creation-actions.ts`
- Modify: `src/features/reviews/review-actions.ts`

**Interfaces:**
- Produces: `RecoveryCode`、`recoveryFor(code)`、`RecoveryAction`。

- [ ] **Step 1: 写错误码和动作测试**

```ts
expect(recoveryFor("NOT_CONFIGURED")).toEqual({ title: "AI 暂未配置", action: "返回修改", retryable: false });
expect(recoveryFor("TIMEOUT")).toMatchObject({ action: "重新生成", retryable: true });
expect(recoveryFor("AI_INPUT_CHANGED")).toMatchObject({ action: "使用最新内容重新生成", retryable: false });
expect(recoveryFor("INTERNAL_STACK")).toMatchObject({ title: "生成未完成" });
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/ai/recovery-contract.test.ts src/components/ui/recovery-action.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现白名单映射与 UI**

```ts
export const recoveryCodes = ["NOT_CONFIGURED", "TIMEOUT", "RATE_LIMITED", "AI_INPUT_CHANGED", "INVALID_AI_OUTPUT", "QUEUE_UNAVAILABLE"] as const;
export type RecoveryCode = typeof recoveryCodes[number];
export function recoveryFor(raw: string) {
  const code = recoveryCodes.includes(raw as RecoveryCode) ? raw as RecoveryCode : "INVALID_AI_OUTPUT";
  return recoveryMap[code];
}
```

```tsx
export function RecoveryAction({ code, retryAction, returnHref }: Props) {
  const recovery = recoveryFor(code);
  return <div className="recovery-action">
    <StatusRow state="error" title={recovery.title} detail={recovery.detail} />
    {recovery.retryable ? <form action={retryAction}><button>重新生成</button></form> : <Link href={returnHref}>{recovery.action}</Link>}
  </div>;
}
```

三个 action 仅返回上述固定码；日志记录内部异常时只写固定事件码和 runId，不写访谈、创作要求、OCR 文本或报告正文。

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/ai src/components/ui/recovery-action.test.tsx src/features/positioning/positioning-actions.test.ts src/features/creation/creation-service.test.ts src/features/reviews/review-actions.test.ts`

Expected: PASS。

```powershell
git add src/features/ai src/components/ui/recovery-action.tsx src/components/ui/recovery-action.test.tsx src/features/positioning/positioning-actions.ts src/features/creation/creation-actions.ts src/features/reviews/review-actions.ts
git commit -m "feat: unify safe ai recovery states"
```

### Task 6: 把恢复组件接入定位、创作和复盘页面

**Files:**
- Modify: `src/app/(product)/positioning/[sessionId]/page.tsx`
- Modify: `src/app/(product)/creation/[projectId]/plan/page.tsx`
- Modify: `src/app/(product)/reviews/[reviewId]/report/page.tsx`
- Modify: `src/features/positioning/positioning-ui.test.tsx`
- Modify: `src/features/creation/creation-ui.test.tsx`
- Modify: `src/features/reviews/review-ui.test.tsx`

**Interfaces:**
- Consumes: `RecoveryAction` 和现有 retry server actions。

- [ ] **Step 1: 写三个页面的失败恢复断言**

```tsx
expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
expect(screen.getByText("已保留上次输入")).toBeInTheDocument();
expect(screen.queryByText(/stack|postgres|deepseek/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/positioning/positioning-ui.test.tsx src/features/creation/creation-ui.test.tsx src/features/reviews/review-ui.test.tsx`

Expected: FAIL，至少一个模块仍使用旧失败文案或缺少重试入口。

- [ ] **Step 3: 页面按最新真实 run 状态渲染**

每页遵循同一分支：`processing` 显示事实状态；`failed` 显示 `RecoveryAction`；存在旧 ready 报告时同时保留“查看上次报告”，但不能把旧报告冒充本次成功；`ready` 才显示新报告。

```tsx
{state.latestRun?.status === "failed" ? <RecoveryAction code={state.latestRun.errorCode ?? "INVALID_AI_OUTPUT"} retryAction={retryAction} returnHref={editHref} /> : null}
{state.previousReadyReport ? <Link href={state.previousReadyReport.href}>查看上次报告</Link> : null}
```

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/positioning src/features/creation src/features/reviews`

Expected: PASS。

```powershell
git add 'src/app/(product)/positioning/[sessionId]/page.tsx' 'src/app/(product)/creation/[projectId]/plan/page.tsx' 'src/app/(product)/reviews/[reviewId]/report/page.tsx' src/features/positioning/positioning-ui.test.tsx src/features/creation/creation-ui.test.tsx src/features/reviews/review-ui.test.tsx
git commit -m "feat: recover failed creator workflows"
```

### Task 7: 验证完整流程承接与发布门槛

**Files:**
- Create: `tests/e2e/flow-recovery.spec.ts`
- Modify: `tests/e2e/helpers.ts`

**Interfaces:**
- Verifies: 下一步优先级、真实恢复、跨模块链接和刷新恢复。

- [ ] **Step 1: 写 Playwright 失败测试**

```ts
test("resumes one real next step across the creator loop", async ({ page }) => {
  await enterAsGuest(page);
  await expect(page.getByTestId("current-step")).toHaveCount(1);
  await page.getByTestId("current-step").getByRole("link").click();
  await expect(page).toHaveURL(/positioning|creation|tasks|reviews/);
  await page.reload();
  await expect(page.getByRole("main")).not.toContainText("undefined");
});

test("failed generation keeps input and offers one safe retry", async ({ page }) => {
  await seedFailedCreationRun();
  await page.goto(failedCreationUrl);
  await expect(page.getByText("已保留上次输入")).toBeVisible();
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect.poll(() => activeRunCount()).toBe(1);
});
```

- [ ] **Step 2: 运行 E2E 并修正仅由测试暴露的路由问题**

Run: `pnpm.cmd exec playwright test tests/e2e/flow-recovery.spec.ts --project=chromium`

Expected: PASS；任何 404、重复 active run、输入丢失或旧报告冒充新结果都必须先修复。

- [ ] **Step 3: 跑 A 阶段全量验证**

Run: `pnpm.cmd lint`

Run: `pnpm.cmd typecheck`

Run: `pnpm.cmd test`

Run: `pnpm.cmd build`

Run: `pnpm.cmd build:worker`

Expected: 全部 exit 0。

- [ ] **Step 4: 提交 A 阶段 E2E 与收口**

```powershell
git add tests/e2e/flow-recovery.spec.ts tests/e2e/helpers.ts
git commit -m "test: verify creator flow recovery"
```
