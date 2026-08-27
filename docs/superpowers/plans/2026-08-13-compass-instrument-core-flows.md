# Compass Instrument Core Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 IP 定位、事前创作、数据复盘、任务、素材、报告和个人档案统一为紧凑、真实、可恢复的手机 App 体验。

**Architecture:** 业务服务、幂等和 owner 校验保持不变；UI 继续消费现有 read service 和 server action。视觉组件只呈现真实状态，所有长内容进入详情页，列表只保留摘要。

**Tech Stack:** Next.js 16、React 19、TypeScript、PostgreSQL/Drizzle、pg-boss、Vitest、Testing Library、Playwright

## Global Constraints

- 先完成视觉基础计划，再执行本计划。
- AI 阶段只能展示后端真实持久化的状态；未知阶段只显示「正在处理」。
- 无 RAG 命中统一说明「暂无匹配案例依据」，不得生成假引用。
- 不修改已稳定的 owner、幂等、版本和 guest merge 约束，除非失败测试证明存在业务漏洞。
- 列表摘要最多两行；详情页展示完整内容。

---

## File Map

- `src/features/positioning/positioning-ui.tsx`：访谈、候选、定位任务摘要。
- `src/features/creation/creation-ui.tsx`：创作方案和创作任务。
- `src/features/reviews/review-ui.tsx`：真实指标、复盘结论和行动。
- `src/features/tasks/task-card.tsx`：三类来源一致的任务卡。
- `src/app/(product)/materials/page.tsx`：紧凑素材列表与抽屉入口。
- `src/features/reports/report-list.tsx`：报告类型、版本和状态。
- `src/app/(product)/me/*`：档案、平台与设置。

### Task 1: Make Positioning Truthful, Compact, and Recoverable

**Files:**
- Modify: `src/features/positioning/positioning-ui.tsx`
- Modify: `src/features/positioning/positioning-ui.test.tsx`
- Modify: `src/features/positioning/positioning-visual-contract.test.ts`
- Modify: `src/features/positioning/ai-run-watcher.tsx`
- Modify: `src/app/(product)/positioning/[sessionId]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `PositioningRunRecord.status`, `errorCode`, `safeErrorDetail`, `PositioningCandidate`.
- Produces: `PositioningRunState` presentation limited to `saved | queued | retrieving | generating | validating | ready | failed` only when persisted.

- [ ] **Step 1: Write failing truthfulness and density tests**

```tsx
it("does not invent retrieval or generation stages from generic processing", () => {
  render(<InterviewPanel sessionId="s1" completeness={82} messages={[]} latestRun={{
    id: "r1", taskType: "profile_extract", status: "processing", errorCode: null, safeErrorDetail: null,
  }} />);
  expect(screen.getByText("请求已保存，AI 正在处理")).toBeInTheDocument();
  expect(screen.queryByText("正在检索已审核资料")).not.toBeInTheDocument();
});

it("keeps every positioning candidate as a clamped summary", () => {
  render(<CandidateCards sessionId="s1" reportId="r1" reportVersion={1} candidates={longCandidates} />);
  for (const item of screen.getAllByTestId("candidate-summary")) {
    expect(item).toHaveClass("line-clamp-2");
  }
});
```

- [ ] **Step 2: Run tests and verify RED where presentation is incomplete**

Run: `pnpm.cmd vitest run src/features/positioning/positioning-ui.test.tsx src/features/positioning/positioning-visual-contract.test.ts`

Expected: at least one new visual/state assertion fails before implementation.

- [ ] **Step 3: Implement real-state presentation**

Keep generic processing to one status row. Add `data-phase="processing"` for styling, not a fake business phase. Render failures with existing `RecoveryAction` only when the action can actually retry the saved run. Add compass numbering to candidates without changing candidate IDs or routes.

```tsx
<article className="candidate-card instrument-panel" data-candidate-index={index + 1}>
  <span className="candidate-card__coordinate">POSITION {String(index + 1).padStart(2, "0")}</span>
  {/* existing real candidate fields and detail link */}
</article>
```

- [ ] **Step 4: Run positioning regression**

Run: `pnpm.cmd vitest run src/features/positioning && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all positioning tests pass; no raw UUID is added to visible copy.

- [ ] **Step 5: Commit**

```powershell
git add src/features/positioning src/app/\(product\)/positioning src/app/globals.css
git commit -m "feat: refine truthful positioning experience"
```

### Task 2: Apply the Instrument System to Creation and Review

**Files:**
- Modify: `src/features/creation/creation-ui.tsx`
- Modify: `src/features/creation/creation-ui.test.tsx`
- Modify: `src/features/creation/creation-visual-contract.test.ts`
- Modify: `src/features/reviews/review-ui.tsx`
- Modify: `src/features/reviews/review-ui.test.tsx`
- Modify: `src/features/reviews/ocr-confirmation.tsx`
- Modify: `src/features/reviews/ocr-confirmation.test.tsx`
- Modify: `src/app/(product)/creation/new/page.tsx`
- Modify: `src/app/(product)/reviews/new/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `ContentPlanOutput`, `ReviewReportOutput`, `CitationView` and confirmed metrics.
- Produces: semantic section coordinates; no new AI output fields.

- [ ] **Step 1: Write failing semantic layout tests**

```tsx
it("labels creation sections as an execution route", () => {
  render(<ContentPlanView plan={articlePlan} citations={[]} />);
  expect(screen.getByText("暂无匹配案例依据", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("正文结构").closest("section")).toHaveAttribute("data-section", "outline");
});

it("renders review metrics in a local data pulse surface", () => {
  render(<ReviewReportView confirmedMetrics={{ views: 100 }} calculatedMetrics={{ interactionRate: null }} report={report} sources={[]} />);
  expect(screen.getByText("已确认的原始数据").closest("section")).toHaveClass("data-pulse-panel");
  expect(screen.getByText("无法计算")).toBeInTheDocument();
});

it("does not persist OCR metrics before user confirmation", async () => {
  const save = vi.fn();
  render(<OcrConfirmation onConfirm={save} />);
  expect(save).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("内容标题"), "真实复盘内容");
  await userEvent.type(screen.getByLabelText("发布时间"), "2026-08-13T12:00:00+08:00");
  await userEvent.type(screen.getByLabelText("播放/阅读量"), "100");
  await userEvent.type(screen.getByLabelText("点赞"), "5");
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认并生成复盘" }));
  expect(save).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd vitest run src/features/creation/creation-ui.test.tsx src/features/reviews/review-ui.test.tsx src/features/reviews/ocr-confirmation.test.tsx`

Expected: FAIL on the new semantic classes/attributes.

- [ ] **Step 3: Implement presentation-only changes**

Change the local `Section` helper to accept a required stable `id` and render `data-section={id}`. Give only the confirmed metrics and calculated metrics sections `data-pulse-panel`; keep long body copy on a calm paper surface. Do not change schemas, prompts, report persistence or task IDs.

```tsx
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section className="creation-plan__section" data-section={id}><h3>{title}</h3>{children}</section>;
}
```

- [ ] **Step 4: Verify creation and review regressions**

Run: `pnpm.cmd vitest run src/features/creation src/features/reviews && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all tests pass; empty citations retain the approved truthful wording.

- [ ] **Step 5: Commit**

```powershell
git add src/features/creation src/features/reviews src/app/\(product\)/creation src/app/\(product\)/reviews src/app/globals.css
git commit -m "feat: refine creation and review surfaces"
```

### Task 3: Unify Tasks, Materials, and Reports

**Files:**
- Modify: `src/features/tasks/task-card.tsx`
- Modify: `src/features/tasks/task-visual-contract.test.ts`
- Modify: `src/app/(product)/tasks/page.tsx`
- Modify: `src/app/(product)/tasks/[id]/page.tsx`
- Modify: `src/app/(product)/materials/page.tsx`
- Modify: `src/features/materials/material-picker.tsx`
- Modify: `src/features/reports/report-list.tsx`
- Modify: `src/app/(product)/reports/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: existing task source type, report status and material active-reference checks.
- Produces: `TaskCard` keeps its existing scalar props and adds `sourceHref?: string`; task list and flow previews reuse the same source treatment.

- [ ] **Step 1: Write failing source and compactness tests**

```tsx
it.each(["positioning", "creation", "review"] as const)(
  "renders a %s task with its source icon and source link",
  (sourceType) => {
    render(<TaskCard id="task-1" title="整理真实场景" plannedDate="2026-08-14" estimatedMinutes={30} completed={false} onCompletedChange={vi.fn()} sourceType={sourceType} sourceHref={`/${sourceType}/source`} />);
    expect(screen.getByLabelText(/来源：/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看来源/ })).toHaveAttribute("href", expect.stringMatching(/^\//));
  },
);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd vitest run src/features/tasks src/features/materials src/features/reports`

Expected: FAIL if task list still bypasses `TaskCard` or source semantics are absent.

- [ ] **Step 3: Reuse the focused record components**

Replace duplicated task-list markup with `TaskCard`. Keep task actions wired to real server actions. Give materials and reports the same 56–64px record rhythm. Keep the existing active-reference deletion guard and report href construction.

- [ ] **Step 4: Verify business behavior and visual contracts**

Run: `pnpm.cmd vitest run src/features/tasks src/features/materials src/features/reports && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all tests pass; task complete/edit/delete and material conflict tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add src/features/tasks src/features/materials src/features/reports src/app/\(product\)/tasks src/app/\(product\)/materials src/app/\(product\)/reports src/app/globals.css
git commit -m "feat: unify task material and report records"
```

### Task 4: Finish Auth, Profile, and Settings Consistency

**Files:**
- Modify: `src/features/identity/auth-ui.tsx`
- Modify: `src/features/identity/auth-ui.test.tsx`
- Create: `src/features/workspace/platform-accounts-view.tsx`
- Create: `src/features/workspace/platform-accounts-view.test.tsx`
- Modify: `src/app/(auth)/welcome/page.tsx`
- Modify: `src/app/(product)/me/page.tsx`
- Modify: `src/app/(product)/me/profile/page.tsx`
- Modify: `src/app/(product)/me/platforms/page.tsx`
- Modify: `src/app/(product)/me/settings/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Better Auth client actions, existing profile version action, platform account read model.
- Produces: `PlatformAccountsView({ accounts, next, notice })` renders saved labels and an explicit statement that platform authorization is unavailable; no new authentication endpoint.

- [ ] **Step 1: Write failing presentation tests**

```tsx
it("does not claim unavailable platform authorization is connected", () => {
  render(<PlatformAccountsView accounts={[]} next="" notice={null} />);
  expect(screen.getByText("不会连接平台、保存授权令牌或自动同步数据。", { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "立即授权" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd vitest run src/features/identity/auth-ui.test.tsx src/features/workspace/platform-accounts-view.test.tsx src/app/not-found.test.tsx`

Expected: FAIL on any new explicit unavailable-state contract.

- [ ] **Step 3: Apply the shared visual system without changing auth semantics**

Use `CompassMark` on welcome/auth, keep server errors and verification behavior unchanged, and render unsupported integrations as disabled explanatory rows instead of active controls.

- [ ] **Step 4: Verify auth and profile regressions**

Run: `pnpm.cmd vitest run src/features/identity src/features/positioning/positioning-read-service.test.ts src/app/not-found.test.tsx && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all tests pass; no credential or token enters rendered HTML.

- [ ] **Step 5: Commit**

```powershell
git add src/features/identity src/app/\(auth\) src/app/\(product\)/me src/app/globals.css
git commit -m "feat: align identity and profile experience"
```
