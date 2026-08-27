# Compass Instrument Visual Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有信息架构的前提下，把用户端升级为 390px「指南针仪表」视觉系统，并完成工作台、工具箱与基础导航改造。

**Architecture:** 视觉令牌继续集中在 `globals.css`，模块语义继续由 `module-icons.ts` 提供，React 组件只组合稳定 class 与真实展示模型。用户端保持手机画板，管理后台不继承手机宽度规则。

**Tech Stack:** Next.js 16、React 19、TypeScript、CSS、Lucide React、Vitest、Testing Library、Playwright

## Global Constraints

- 用户端基准宽度 390px，并验收 360×800、390×844、412×915。
- 列表行 56–64px、候选摘要 130–148px、任务 76–84px、主要控件 42px。
- 不使用紫蓝 AI 渐变、模板化 Bento、大面积发光、厚阴影或无法解释的装饰数据。
- 图标统一 18px、`strokeWidth={1.8}`；动效 160–220ms，并支持 `prefers-reduced-motion`。
- 不新增图标库、动画库、数据库字段或第二套业务状态机。

---

## File Map

- `src/app/globals.css`：视觉令牌、罗盘背景、局部深色行动区、移动尺寸与 reduced motion。
- `src/features/navigation/module-icons.ts`：一级模块、报告和任务来源的唯一图标映射。
- `src/components/ui/compass-mark.tsx`：纯装饰品牌标识，不读取业务数据。
- `src/components/app-shell/app-shell.tsx`：手机画板、顶部坐标与页面层级。
- `src/features/workspace/current-step-row.tsx`：工作台唯一主行动。
- `src/features/workspace/workspace-view.tsx`：真实指标、任务与报告的紧凑编排。
- `src/features/tools/tools-view.tsx`：五个模块的仪表式目录。

### Task 1: Lock the Visual Tokens and Density Contract

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/app-shell/visual-contract.test.ts`
- Modify: `src/components/ui/mobile-primitives.test.tsx`

**Interfaces:**
- Consumes: existing `--cc-*` tokens and `.app-shell` layout.
- Produces: `--cc-ink-deep`, `--cc-grid`, `--cc-coordinate`, `.compass-surface`, `.instrument-panel`, `.data-pulse-panel`.

- [ ] **Step 1: Write the failing CSS contract**

```ts
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");

it("defines the compass instrument tokens without AI gradients", () => {
  expect(css).toContain("--cc-ink-deep: #102a33");
  expect(css).toContain("--cc-grid:");
  expect(css).toContain(".compass-surface");
  expect(css).toContain(".instrument-panel");
  expect(css).toContain(".data-pulse-panel");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).not.toMatch(/linear-gradient\([^)]*(#7c3aed|#6366f1|#8b5cf6)/i);
});

it.each([[360, 800], [390, 844], [412, 915]])(
  "keeps the mobile shell compact at %sx%s",
  (width) => expect(width).toBeGreaterThanOrEqual(360),
);
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `pnpm.cmd vitest run src/components/app-shell/visual-contract.test.ts src/components/ui/mobile-primitives.test.tsx`

Expected: FAIL because the new compass tokens and classes do not exist.

- [ ] **Step 3: Add the minimal token and surface implementation**

```css
:root {
  --cc-ink-deep: #102a33;
  --cc-coordinate: #3f8588;
  --cc-grid: rgb(16 42 51 / 7%);
  --cc-paper: #f4f2ec;
}

.compass-surface {
  background-color: var(--cc-bg);
  background-image:
    linear-gradient(var(--cc-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--cc-grid) 1px, transparent 1px);
  background-size: 24px 24px;
}

.instrument-panel {
  border: 1px solid rgb(16 42 51 / 22%);
  border-radius: 8px;
  background: var(--cc-surface);
}

.data-pulse-panel {
  border: 1px solid rgb(105 207 200 / 28%);
  border-radius: 8px;
  background: var(--cc-ink-deep);
  color: #f5fbfa;
}

@media (prefers-reduced-motion: reduce) {
  .compass-surface *, .instrument-panel *, .data-pulse-panel * {
    scroll-behavior: auto;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Run tests and static checks**

Run: `pnpm.cmd vitest run src/components/app-shell/visual-contract.test.ts src/components/ui/mobile-primitives.test.tsx && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add src/app/globals.css src/components/app-shell/visual-contract.test.ts src/components/ui/mobile-primitives.test.tsx
git commit -m "feat: add compass instrument visual tokens"
```

### Task 2: Add the Compass Brand Mark and Shell Hierarchy

**Files:**
- Create: `src/components/ui/compass-mark.tsx`
- Create: `src/components/ui/compass-mark.test.tsx`
- Modify: `src/components/app-shell/app-shell.tsx`
- Modify: `src/components/app-shell/app-shell.test.tsx`
- Modify: `src/components/app-shell/bottom-nav.tsx`

**Interfaces:**
- Consumes: `AppShellProps`, `ProductTabId`, compass tokens from Task 1.
- Produces: `CompassMark({ label, size?: "small" | "medium" })` and `AppShellProps.coordinate?: string`.

- [ ] **Step 1: Write the failing component tests**

```tsx
it("renders an accessible compass mark without text duplication", () => {
  render(<CompassMark label="Creator Compass" size="small" />);
  expect(screen.getByLabelText("Creator Compass")).toHaveAttribute("data-size", "small");
});

it("renders an optional coordinate in the app bar", () => {
  render(<AppShell title="工作台" coordinate="TODAY · POSITION 03" activeTab="workspace">正文</AppShell>);
  expect(screen.getByText("TODAY · POSITION 03")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd vitest run src/components/ui/compass-mark.test.tsx src/components/app-shell/app-shell.test.tsx`

Expected: FAIL because `CompassMark` and `coordinate` do not exist.

- [ ] **Step 3: Implement the focused interfaces**

```tsx
export function CompassMark({ label, size = "medium" }: {
  label: string;
  size?: "small" | "medium";
}) {
  return (
    <span className="compass-mark" data-size={size} aria-label={label}>
      <span aria-hidden="true" className="compass-mark__ring" />
      <span aria-hidden="true" className="compass-mark__needle" />
    </span>
  );
}
```

Extend the shell base props with `coordinate?: string` and render it inside `.app-bar__leading` before the centered title. Keep the existing back link and bottom navigation behavior unchanged.

- [ ] **Step 4: Verify navigation and accessibility**

Run: `pnpm.cmd vitest run src/components/ui/compass-mark.test.tsx src/components/app-shell && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all tests pass; every nav item still has text and `aria-current`.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ui/compass-mark.tsx src/components/ui/compass-mark.test.tsx src/components/app-shell
git commit -m "feat: add compass shell hierarchy"
```

### Task 3: Redesign Workspace and Tools Without Enlarging Modules

**Files:**
- Modify: `src/features/workspace/current-step-row.tsx`
- Modify: `src/features/workspace/workspace-view.tsx`
- Modify: `src/features/workspace/workspace-view.test.tsx`
- Modify: `src/features/tools/tools-view.tsx`
- Modify: `src/features/tools/tools-view.test.tsx`
- Modify: `src/app/(product)/workspace/page.tsx`
- Modify: `src/app/(product)/tools/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: existing `WorkspaceViewModel`, `NextAction`, `TOOL_ENTRIES`, `ModuleIcon`.
- Produces: no new business state; only new structural classes and coordinate labels.

- [ ] **Step 1: Write the failing workspace and tools assertions**

```tsx
it("shows one dark current action and no more than two upcoming tasks", () => {
  render(<WorkspaceView view={activeViewWithThreeTasks} />);
  expect(screen.getByTestId("current-step")).toHaveClass("instrument-action");
  expect(screen.getAllByTestId("workspace-task")).toHaveLength(2);
});

it("renders five compact tools with stable module identities", () => {
  render(<ToolsView />);
  expect(screen.getAllByTestId("tool-entry")).toHaveLength(5);
  expect(screen.getByText("IP 定位").closest("a")).toHaveAttribute("data-module", "positioning");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd vitest run src/features/workspace/workspace-view.test.tsx src/features/tools/tools-view.test.tsx`

Expected: FAIL on the new class and `data-module` attributes.

- [ ] **Step 3: Implement the new hierarchy with existing data**

Add `instrument-action` to `CurrentStepRow`. Add `data-module={entry.id}` to each tool link. Pass `coordinate="TODAY · POSITION"` to the workspace shell and `coordinate="MODULE INDEX · 05"` to the tools shell. Keep the existing metric calculations, range links, empty states and route targets unchanged.

```tsx
<section className="current-step-row instrument-action" data-stage={action.stage} data-testid="current-step">
  <span className="instrument-action__coordinate">NEXT ACTION</span>
  {/* existing icon, copy and real link */}
</section>
```

- [ ] **Step 4: Verify compact density and routing**

Run: `pnpm.cmd vitest run src/features/workspace src/features/tools src/components/app-shell && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all tests pass; workspace still renders at most two task links and five tools keep their existing hrefs.

- [ ] **Step 5: Commit**

```powershell
git add src/features/workspace src/features/tools src/app/\(product\)/workspace src/app/\(product\)/tools src/app/globals.css
git commit -m "feat: apply compass design to workspace and tools"
```
