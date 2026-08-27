# Phase 1 Workspace and DeepSeek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the running local product to real DeepSeek and deliver the first Figma-density optimization batch covering shared UI primitives and the workspace.

**Architecture:** Preserve the existing Next.js server-component, service-layer, PostgreSQL, and pg-boss boundaries. UI work stays in shared CSS and focused workspace components; AI secrets remain in ignored local environment configuration and are read only by server processes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, PostgreSQL 16, pg-boss, DeepSeek `deepseek-chat`, plain CSS design tokens.

## Global Constraints

- The product remains a 390px mobile canvas, with a 48px top bar, 62px bottom bar, and 42px primary controls.
- Page horizontal padding remains 15px; module spacing is 8–10px; radii are 6–8px.
- Ordinary list rows are 46–64px; list copy is clamped to one or two lines and full content remains available on detail pages.
- No gradients, thick shadows, glass effects, decorative oversized cards, fake metrics, fake AI stages, or fake cases.
- Every page has one primary action; secondary actions use light buttons or text links.
- The DeepSeek key remains only in ignored `.env.local`; it never appears in source, tests, logs, documentation, or Git.
- Existing owner isolation, immutable report versions, Zod validation, retrieval gates, and transactional persistence remain unchanged.

---

### Task 1: Activate the real DeepSeek adapter safely

**Files:**
- Modify locally, never stage: `.env.local`
- Verify: `src/server/ai/test-ai-adapter.test.ts`
- Verify: `src/server/ai/deepseek-client.test.ts`
- Verify: `src/server/ai/run-ai-task.test.ts`

**Interfaces:**
- Consumes: existing `isTestAiAdapterEnabled(environment)` loopback guard and `DeepSeekClient`.
- Produces: a restarted web/worker pair with `AI_ADAPTER=deepseek` and model `deepseek-chat`.

- [ ] **Step 1: Confirm the secret file is ignored**

Run:

```powershell
git check-ignore .env.local
git status --short -- .env.local
```

Expected: `.env.local` is reported by `check-ignore` and absent from Git status.

- [ ] **Step 2: Update only the local AI runtime values**

Keep the user-provided key only in `DEEPSEEK_API_KEY`; set these non-secret values exactly:

```dotenv
AI_ADAPTER=deepseek
DEEPSEEK_MODEL=deepseek-chat
```

Do not print the file or the key after editing.

- [ ] **Step 3: Run the adapter and security tests**

Run:

```powershell
pnpm.cmd vitest run src/server/ai/test-ai-adapter.test.ts src/server/ai/deepseek-client.test.ts src/server/ai/run-ai-task.test.ts
```

Expected: all selected tests pass; the production test adapter remains disabled unless the explicit loopback experience mode is selected.

- [ ] **Step 4: Restart the local product without exposing the key**

Run the committed stop/start scripts. Do not pass the key as a command-line argument:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local-product.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-product.ps1 -NoOpen
```

Expected: `/api/health` reports `healthy` for web, database, worker, and storage.

- [ ] **Step 5: Commit only code changes if any are required**

No commit is expected for `.env.local`. If a safety regression requires source changes, stage only the relevant test and implementation files and use:

```powershell
git commit -m "fix: secure local deepseek activation"
```

---

### Task 2: Tighten shared mobile UI primitives

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/app-shell/visual-contract.test.ts`
- Test: `src/components/app-shell/app-shell.test.tsx`

**Interfaces:**
- Consumes: existing `.compact-page`, `.compact-stack`, `.compact-section-label`, `.compact-empty`, `.compact-card`, and `.app-content` class contracts.
- Produces: shared compact primitives used without page-specific wrappers by all later phases.

- [ ] **Step 1: Add failing density assertions**

Extend `visual-contract.test.ts` with exact assertions:

```ts
test("keeps shared groups and empty states compact", () => {
  expect(styles).toMatch(/\.compact-page\s*\{[^}]*gap:\s*8px/s);
  expect(styles).toMatch(/\.compact-stack\s*\{[^}]*gap:\s*6px/s);
  expect(styles).toMatch(/\.compact-empty\s*\{[^}]*padding:\s*12px 4px/s);
  expect(styles).not.toMatch(/\.compact-empty\s*\{[^}]*border:\s*1px dashed/s);
});
```

- [ ] **Step 2: Run the visual contract to verify RED**

Run:

```powershell
pnpm.cmd vitest run src/components/app-shell/visual-contract.test.ts
```

Expected: failure because the current page gap is 10px, stack gap is 8px, and the empty state uses 30px padding plus a dashed box.

- [ ] **Step 3: Implement the shared compact primitives**

Change the relevant rules in `globals.css` to these values while preserving existing colors and typography:

```css
.compact-stack {
  display: grid;
  gap: 6px;
}

.compact-section-label {
  padding: 6px 0;
  color: var(--muted);
  font-size: 11px;
}

.compact-empty {
  padding: 12px 4px;
  border-block: 1px solid var(--line);
  color: var(--muted);
  text-align: left;
}

.compact-page {
  display: grid;
  gap: 8px;
}
```

Keep `.compact-empty` without a card radius because it is status copy, not an independent object.

- [ ] **Step 4: Run shared component tests**

Run:

```powershell
pnpm.cmd vitest run src/components/app-shell/visual-contract.test.ts src/components/app-shell/app-shell.test.tsx
```

Expected: both test files pass.

- [ ] **Step 5: Commit the shared foundation**

```powershell
git add src/app/globals.css src/components/app-shell/visual-contract.test.ts
git commit -m "style: tighten shared mobile interface density"
```

---

### Task 3: Recompose the workspace around current state and next action

**Files:**
- Modify: `src/features/workspace/workspace-view.tsx`
- Modify: `src/app/globals.css`
- Create: `src/features/workspace/workspace-view.test.tsx`
- Create: `src/features/workspace/workspace-visual-contract.test.ts`
- Verify: `src/features/workspace/workspace-service.test.ts`

**Interfaces:**
- Consumes: `WorkspaceViewModel` from `workspace-service.ts` and the shared compact primitives from Task 2.
- Produces: `WorkspaceView({ view }: { view: WorkspaceViewModel })` with one clear next action and bounded list rows.

- [ ] **Step 1: Write failing behavior tests**

Create `workspace-view.test.tsx` with Testing Library coverage for both states:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { WorkspaceViewModel } from "./workspace-service";
import { WorkspaceView } from "./workspace-view";

const activeWorkspaceFixture: WorkspaceViewModel = {
  kind: "activeUser",
  range: 7,
  accounts: [{ id: "account-1", platform: "xiaohongshu", accountLabel: "主账号", dataSource: "ocr", isActive: true }],
  activeAccount: { id: "account-1", platform: "xiaohongshu", accountLabel: "主账号", dataSource: "ocr", isActive: true },
  metrics: { views: 1200, interactionRate: 0.06, followerConversionRate: 0.01 },
  trend: [{ date: "2026-08-08", views: 1000 }, { date: "2026-08-09", views: 1200 }],
  insight: { reportId: "report-1", reviewId: "review-1", version: 1, problem: "标题表达不够具体", action: "下一条改用结果型标题" },
  upcomingTasks: [
    { id: "task-1", title: "整理真实案例", plannedDate: "2026-08-10", status: "pending", completed: false, daysFromToday: 1 },
    { id: "task-2", title: "完成内容初稿", plannedDate: "2026-08-11", status: "in_progress", completed: false, daysFromToday: 2 },
  ],
  recentReports: [{ id: "report-2", type: "review", title: "产品学习复盘", summary: "查看本轮结论", createdAt: new Date("2026-08-09T08:00:00+08:00") }],
};

test("new users see one primary next action and a quieter positioning alternative", () => {
  render(<WorkspaceView view={{ kind: "newUser", range: 7, accounts: [] }} />);
  expect(screen.getByRole("link", { name: "添加账号标签" })).toHaveAttribute("data-variant", "primary");
  expect(screen.getByRole("link", { name: "先完成 IP 定位" })).toHaveAttribute("data-variant", "text");
  expect(screen.queryByText(/0%|预计|模拟数据/)).not.toBeInTheDocument();
});

test("active users see account, metrics, next tasks and report without duplicated primary actions", () => {
  render(<WorkspaceView view={activeWorkspaceFixture} />);
  expect(screen.getByRole("link", { name: /主账号/ })).toBeInTheDocument();
  expect(screen.getByText("接下来")).toBeInTheDocument();
  expect(screen.getAllByTestId("workspace-task")).toHaveLength(2);
  expect(screen.getAllByRole("link").filter((item) => item.getAttribute("data-variant") === "primary")).toHaveLength(0);
});
```

- [ ] **Step 2: Write failing CSS height assertions**

Create `workspace-visual-contract.test.ts`:

```ts
const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

test("keeps workspace rows within the Figma density", () => {
  expect(styles).toMatch(/\.workspace-account\s*\{[^}]*min-height:\s*40px/s);
  expect(styles).toMatch(/\.workspace-metrics > div\s*\{[^}]*min-height:\s*54px/s);
  expect(styles).toMatch(/\.workspace-chart\s*\{[^}]*height:\s*72px/s);
  expect(styles).toMatch(/\.workspace-task\s*\{[^}]*min-height:\s*44px/s);
  expect(styles).toMatch(/\.workspace-report\s*\{[^}]*min-height:\s*48px/s);
});
```

- [ ] **Step 3: Run both tests to verify RED**

Run:

```powershell
pnpm.cmd vitest run src/features/workspace/workspace-view.test.tsx src/features/workspace/workspace-visual-contract.test.ts
```

Expected: failures because the view has no test IDs or primary/text action hierarchy and current heights are 42/58/84/46/54.

- [ ] **Step 4: Implement the workspace hierarchy**

Update the new-user branch to use one compact message, one primary 42px link, and one text link:

```tsx
if (view.kind === "newUser") return (
  <div className="workspace-empty compact-page">
    <div className="workspace-empty__copy">
      <strong>先确定一个起点</strong>
      <span>添加账号标签后显示真实数据，也可以先完成 IP 定位。</span>
    </div>
    <Link className="compact-button" data-variant="primary" href="/me/platforms">添加账号标签</Link>
    <Link className="compact-text-action" data-variant="text" href="/positioning">先完成 IP 定位</Link>
  </div>
);
```

In the active branch, add `data-testid="workspace-task"` to task links, retain the current real values, and keep report/insight links as secondary list objects rather than large actions.

- [ ] **Step 5: Apply the exact workspace density values**

Use these CSS bounds:

```css
.workspace-account { min-height: 40px; }
.workspace-metrics > div { min-height: 54px; }
.workspace-chart { height: 72px; }
.workspace-chart svg { height: 50px; }
.workspace-insight { min-height: 56px; }
.workspace-task { min-height: 44px; }
.workspace-report { min-height: 48px; }
```

Add one- or two-line clamping to insight, task, and report copy; do not hide dates or report status.

- [ ] **Step 6: Run workspace tests to verify GREEN**

Run:

```powershell
pnpm.cmd vitest run src/features/workspace/workspace-view.test.tsx src/features/workspace/workspace-visual-contract.test.ts src/features/workspace/workspace-service.test.ts
```

Expected: all workspace behavior, data filtering, and density tests pass.

- [ ] **Step 7: Commit the workspace batch**

```powershell
git add src/features/workspace/workspace-view.tsx src/features/workspace/workspace-view.test.tsx src/features/workspace/workspace-visual-contract.test.ts src/app/globals.css
git commit -m "feat: clarify the compact workspace next step"
```

---

### Task 4: Verify responsive and accessibility behavior

**Files:**
- Modify if a failure is found: `src/app/globals.css`
- Modify if a failure is found: `src/features/workspace/workspace-view.tsx`
- Verify: `src/components/app-shell/visual-contract.test.ts`
- Verify: `src/features/workspace/workspace-view.test.tsx`

**Interfaces:**
- Consumes: Task 2 shared primitives and Task 3 workspace markup.
- Produces: a layout that remains usable at 360×800, 390×844, and 412×915.

- [ ] **Step 1: Run static overflow and focus checks**

Run:

```powershell
rg -n "min-width: [4-9][0-9]{2}px|width: [4-9][0-9]{2}px|overflow-x: auto" src/app/globals.css src/features/workspace
pnpm.cmd vitest run src/components/app-shell/visual-contract.test.ts src/features/workspace/workspace-view.test.tsx
```

Expected: no fixed content width greater than the 390px shell, and all selected tests pass.

- [ ] **Step 2: Verify keyboard semantics in tests**

Ensure the account switch, range controls, primary action, tasks, insight, and report remain native links with accessible names. Add assertions using `getByRole("link", { name })` for any missing path.

- [ ] **Step 3: Fix only observed failures**

If a long label overflows, apply the existing truncation pattern:

```css
min-width: 0;
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

Do not introduce smaller than 10px functional text to make content fit.

- [ ] **Step 4: Commit responsive fixes if files changed**

```powershell
git add src/app/globals.css src/features/workspace/workspace-view.tsx src/features/workspace/workspace-view.test.tsx
git commit -m "fix: harden workspace responsive behavior"
```

Skip the commit only when the verification produces no changes.

---

### Task 5: Full verification, real AI smoke test, and runtime handoff

**Files:**
- Verify only: all Phase 1 files
- Runtime-only output: `C:\Temp\CreatorCompassRuntime\creator-compass.stderr.log`

**Interfaces:**
- Consumes: all Phase 1 tasks.
- Produces: a running, healthy app on `http://127.0.0.1:3000` with the real DeepSeek adapter selected.

- [ ] **Step 1: Run the complete automated suite with the real test database**

Set `DATABASE_URL` and `TEST_DATABASE_URL` to the existing isolated `creator_compass_test` database, then run:

```powershell
pnpm.cmd test
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd build:worker
git diff --check
```

Expected: 285 or more tests pass with no skipped PostgreSQL integration test; lint, typecheck, both builds, and diff check exit 0.

- [ ] **Step 2: Restart the final build**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local-product.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local-product.ps1 -NoOpen
```

Expected: `http://127.0.0.1:3000/api/health` returns HTTP 200 with all four components healthy.

- [ ] **Step 3: Execute one user-authorized DeepSeek smoke flow**

Use a non-sensitive test statement created for this product, such as “我想记录自己的产品学习过程，每周可投入三小时”, through the positioning flow. Verify that the resulting `ai_runs.model` is `deepseek-chat`, status becomes `ready`, and the UI shows no fabricated citation when retrieval returns no approved source.

- [ ] **Step 4: Check secret hygiene and logs**

Run:

```powershell
git status --short
git grep -n "DEEPSEEK_API_KEY="
```

Expected: `.env.local` remains absent from status; tracked files do not contain a key assignment. Inspect only error categories in the runtime log and never print request headers or environment values.

- [ ] **Step 5: Commit the verified Phase 1 result**

```powershell
git add src/app/globals.css src/components/app-shell/visual-contract.test.ts src/features/workspace
git commit -m "feat: optimize workspace and activate deepseek"
```

If Tasks 2–4 already produced clean commits and Task 5 has no additional source change, do not create an empty commit.
