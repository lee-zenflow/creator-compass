# Creator Compass 手机前台深化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变已验证业务语义的前提下，把全部用户前台统一为 390×844 紧凑手机产品，并补齐图标、状态、跨模块承接与长内容密度。

**Architecture:** 业务 service/action 保持现状，新增纯展示层设计令牌、图标注册表与可复用紧凑组件。Server Component 继续读取真实数据库状态，Client Component 只管理表单、展开和轮询，不制造假数据或假进度。

**Tech Stack:** Next.js 16、React 19、TypeScript、lucide-react、CSS、Vitest、Testing Library、Playwright。

## Global Constraints

- 主画板为 390×844，必须适配 360–430px；桌面只居中显示手机画板。
- 页面背景 `#F4F7F6`，主表面 `#FFFFFF`，主文字 `#17252B`，主交互 `#397E83`，分隔线 `#D9E3E4`。
- 页面左右边距 15px；顶栏 48px；底栏 62px；主按钮 42px；普通列表 48–64px；任务卡约 84px；候选卡约 148px。
- 统一使用 lucide-react：18px、约 1.8px 描边、36px 小圆角底座；关键图标必须同时有文字标签。
- 列表摘要最多两行；不新增大渐变、厚阴影、大欢迎卡、模拟指标、假进度或预计时长。
- 页面始终只有一个主操作；AI、OCR、任务和报告状态必须来自数据库。

---

## File Map

- `src/app/globals.css`：唯一视觉令牌和全局密度规则。
- `src/components/ui/module-icon.tsx`：一级模块图标底座。
- `src/components/ui/status-row.tsx`：加载、空、错误、完成状态行。
- `src/components/ui/metric-sparkline.tsx`：无外部图表依赖的可访问 SVG 趋势图。
- `src/features/navigation/module-icons.ts`：模块、报告和任务来源到 Lucide 图标的唯一映射。
- `src/components/app-shell/*`：手机画板、顶栏和底栏。
- `src/features/*/*-ui.tsx`：各业务紧凑视图，不读取数据库。
- `src/app/(product)/**/page.tsx`：读取真实 view model 并组合页面。

### Task 1: 视觉令牌、图标注册表和共享组件

**Files:**
- Create: `src/features/navigation/module-icons.ts`
- Create: `src/components/ui/module-icon.tsx`
- Create: `src/components/ui/status-row.tsx`
- Create: `src/components/ui/metric-sparkline.tsx`
- Create: `src/components/ui/mobile-primitives.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `MODULE_ICONS`, `REPORT_ICONS`, `TASK_SOURCE_ICONS`, `ModuleIcon`, `StatusRow`, `MetricSparkline`。

- [ ] **Step 1: 写失败测试，固定图标、两行摘要和趋势图可访问性**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ModuleIcon } from "./module-icon";
import { MetricSparkline } from "./metric-sparkline";

describe("mobile visual primitives", () => {
  test("module icon keeps a labelled 36px visual base", () => {
    render(<ModuleIcon name="positioning" label="IP 定位" />);
    expect(screen.getByLabelText("IP 定位")).toHaveAttribute("data-module", "positioning");
  });

  test("sparkline exposes its real data summary", () => {
    render(<MetricSparkline label="播放趋势" points={[12, 18, 16]} />);
    expect(screen.getByRole("img", { name: "播放趋势：12、18、16" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试并确认因组件不存在失败**

Run: `pnpm.cmd vitest run src/components/ui/mobile-primitives.test.tsx`

Expected: FAIL，提示无法解析 `module-icon` 或 `metric-sparkline`。

- [ ] **Step 3: 建立唯一图标映射与组件实现**

```tsx
// src/features/navigation/module-icons.ts
import { BarChart3, BookOpenText, Boxes, Compass, FileText, Library, ListChecks, PenLine, RefreshCw, Settings, Sparkles, UserRound } from "lucide-react";

export const MODULE_ICONS = {
  workspace: BarChart3,
  tools: Boxes,
  positioning: Compass,
  creation: PenLine,
  review: RefreshCw,
  materials: Library,
  reports: FileText,
  tasks: ListChecks,
  profile: UserRound,
  knowledge: BookOpenText,
  settings: Settings,
  ai: Sparkles,
} as const;

export type ModuleIconName = keyof typeof MODULE_ICONS;
export const REPORT_ICONS = { positioning: Compass, creation: PenLine, review: RefreshCw } as const;
export const TASK_SOURCE_ICONS = REPORT_ICONS;
```

```tsx
// src/components/ui/module-icon.tsx
import { MODULE_ICONS, type ModuleIconName } from "@/features/navigation/module-icons";

export function ModuleIcon({ name, label, tone = "teal" }: { name: ModuleIconName; label: string; tone?: "teal" | "blue" | "gold" | "red" }) {
  const Icon = MODULE_ICONS[name];
  return <span className="module-icon" data-module={name} data-tone={tone} aria-label={label}><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span>;
}
```

```tsx
// src/components/ui/metric-sparkline.tsx
export function MetricSparkline({ label, points }: { label: string; points: number[] }) {
  const max = Math.max(...points, 1);
  const denominator = Math.max(points.length - 1, 1);
  const path = points.map((value, index) => `${(index / denominator) * 100},${32 - (value / max) * 28}`).join(" ");
  return <svg className="metric-sparkline" viewBox="0 0 100 36" role="img" aria-label={`${label}：${points.join("、")}`}><polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
```

```tsx
// src/components/ui/status-row.tsx
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";

export function StatusRow({ state, title, detail }: { state: "processing" | "empty" | "error" | "success"; title: string; detail?: string }) {
  const Icon = state === "error" ? CircleAlert : state === "success" ? CircleCheck : LoaderCircle;
  return <div className="status-row" role={state === "error" ? "alert" : "status"} data-state={state}><Icon aria-hidden="true" size={18} /><span><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span></div>;
}
```

- [ ] **Step 4: 在 `globals.css` 添加令牌与密度规则并跑测试**

```css
:root {
  --cc-bg: #f4f7f6;
  --cc-surface: #ffffff;
  --cc-text: #17252b;
  --cc-muted: #5f7177;
  --cc-faint: #718086;
  --cc-accent: #397e83;
  --cc-accent-deep: #223f49;
  --cc-accent-soft: #e7f0f1;
  --cc-line: #d9e3e4;
  --cc-radius: 8px;
}
.module-icon { width: 36px; height: 36px; border-radius: 8px; display: inline-grid; place-items: center; color: var(--cc-accent); background: var(--cc-accent-soft); flex: 0 0 36px; }
.module-icon[data-tone="blue"] { color: #416f9b; background: #eaf1f7; }
.module-icon[data-tone="gold"] { color: #8a6a26; background: #f6f0df; }
.module-icon[data-tone="red"] { color: #a14d4d; background: #f8eaea; }
.line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.metric-sparkline { width: 100%; height: 36px; color: var(--cc-accent); }
```

Run: `pnpm.cmd vitest run src/components/ui/mobile-primitives.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交共享视觉底座**

```powershell
git add src/app/globals.css src/features/navigation/module-icons.ts src/components/ui/module-icon.tsx src/components/ui/status-row.tsx src/components/ui/metric-sparkline.tsx src/components/ui/mobile-primitives.test.tsx
git commit -m "style: add compact mobile visual system"
```

### Task 2: AppShell 手机比例与主导航

**Files:**
- Modify: `src/components/app-shell/app-shell.tsx`
- Modify: `src/components/app-shell/bottom-nav.tsx`
- Modify: `src/components/app-shell/app-shell.test.tsx`
- Modify: `src/components/app-shell/visual-contract.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `MODULE_ICONS`。
- Produces: 所有产品页一致的 390px 手机画板、48px 顶栏和 62px 底栏。

- [ ] **Step 1: 扩展测试，固定四个图标导航与桌面居中画板**

```tsx
test("renders four labelled icon tabs", () => {
  render(<AppShell title="工作台" activeTab="workspace"><p>内容</p></AppShell>);
  expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
  for (const label of ["工作台", "工具箱", "任务", "我的"]) expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行 AppShell 测试，确认旧结构不满足新图标契约**

Run: `pnpm.cmd vitest run src/components/app-shell`

Expected: 新增断言 FAIL。

- [ ] **Step 3: 用 `MODULE_ICONS` 替换重复图标定义，并保留现有路由**

```tsx
const TAB_ICONS = {
  workspace: MODULE_ICONS.workspace,
  tools: MODULE_ICONS.tools,
  tasks: MODULE_ICONS.tasks,
  me: MODULE_ICONS.profile,
} satisfies Record<ProductTabId, LucideIcon>;
```

- [ ] **Step 4: 添加手机画板 CSS 并验证 360–430px 无横向溢出**

```css
.app-viewport { min-height: 100dvh; background: #e9efee; display: flex; justify-content: center; }
.app-shell { width: min(100%, 390px); min-height: 100dvh; background: var(--cc-bg); position: relative; overflow-x: clip; }
@media (min-width: 700px) { .app-shell { min-height: 844px; box-shadow: 0 0 0 1px var(--cc-line); } }
.app-content { padding: 8px 15px calc(70px + env(safe-area-inset-bottom)); }
```

Run: `pnpm.cmd vitest run src/components/app-shell && pnpm.cmd typecheck`

Expected: PASS，TypeScript 0 errors。

- [ ] **Step 5: 提交 AppShell**

```powershell
git add src/components/app-shell src/app/globals.css
git commit -m "style: enforce compact mobile app shell"
```

### Task 3: 工作台、工具箱和真实趋势图

**Files:**
- Modify: `src/features/workspace/workspace-view.tsx`
- Modify: `src/features/workspace/workspace-view.test.tsx`
- Modify: `src/features/workspace/workspace-visual-contract.test.ts`
- Modify: `src/app/(product)/tools/page.tsx`
- Create: `src/features/tools/tools-view.tsx`
- Create: `src/features/tools/tools-view.test.tsx`

**Interfaces:**
- Consumes: `WorkspaceViewModel`, `ModuleIcon`, `MetricSparkline`。
- Produces: 真实指标、两条任务、最近报告与五个工具入口。

- [ ] **Step 1: 写失败测试，要求工作台有三指标、小图表和最多两条任务**

```tsx
test("active workspace keeps real metrics compact", () => {
  render(<WorkspaceView view={activeWorkspaceFixture} />);
  expect(screen.getByRole("img", { name: /播放趋势/ })).toBeInTheDocument();
  expect(screen.getAllByTestId("workspace-metric")).toHaveLength(3);
  expect(screen.getAllByTestId("workspace-task")).toHaveLength(2);
  expect(screen.queryByText(/模拟|预计完成/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行两组测试并确认缺少趋势图或工具图标失败**

Run: `pnpm.cmd vitest run src/features/workspace src/features/tools`

Expected: FAIL。

- [ ] **Step 3: 在 WorkspaceView 仅使用 view model 真实值渲染**

```tsx
<section className="metric-strip" aria-label="周期指标">
  {[
    ["播放/曝光", view.metrics.views.toLocaleString("zh-CN")],
    ["互动率", `${(view.metrics.interactionRate * 100).toFixed(1)}%`],
    ["涨粉转化", `${(view.metrics.followerConversionRate * 100).toFixed(1)}%`],
  ].map(([label, value]) => <div data-testid="workspace-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
</section>
<MetricSparkline label="播放趋势" points={view.trend.map((point) => point.views)} />
```

- [ ] **Step 4: 工具箱只渲染五个紧凑入口**

```tsx
export const TOOL_ENTRIES = [
  ["positioning", "IP 定位", "对话梳理方向", "/positioning"],
  ["creation", "事前创作", "生成方案与任务", "/creation/new"],
  ["review", "数据复盘", "确认数据并复盘", "/reviews/new"],
  ["materials", "素材库", "保存与复用素材", "/materials"],
  ["reports", "报告记录", "查看历史版本", "/reports"],
] as const;
```

Run: `pnpm.cmd vitest run src/features/workspace src/features/tools`

Expected: PASS。

- [ ] **Step 5: 提交工作台与工具箱**

```powershell
git add src/features/workspace src/features/tools 'src/app/(product)/tools/page.tsx'
git commit -m "style: deepen workspace and tool entry views"
```

### Task 4: 定位、创作和复盘长内容密度

**Files:**
- Modify: `src/features/positioning/positioning-ui.tsx`
- Modify: `src/features/positioning/positioning-ui.test.tsx`
- Modify: `src/features/creation/creation-ui.tsx`
- Modify: `src/features/creation/creation-ui.test.tsx`
- Modify: `src/features/reviews/review-ui.tsx`
- Modify: `src/features/reviews/review-ui.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: 现有定位、创作、复盘 view model 和 actions。
- Produces: 148px 候选摘要、84px 任务摘要、真实 AI 状态和详情展开。

- [ ] **Step 1: 写失败测试，列表不展开完整模型正文**

```tsx
test("candidate list clamps generated explanations", () => {
  render(<CandidateCards candidates={[longCandidate]} sessionId="session-1" reportVersion={1} />);
  expect(screen.getByTestId("candidate-summary")).toHaveClass("line-clamp-2");
  expect(screen.getByRole("link", { name: /查看详情/ })).toBeInTheDocument();
});

test("review report distinguishes missing knowledge evidence", () => {
  render(<ReviewReportView report={{ ...reportFixture, citations: [] }} />);
  expect(screen.getByText("仅基于确认数据与个人资料，暂无匹配案例依据")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行三类 UI 测试并确认失败**

Run: `pnpm.cmd vitest run src/features/positioning/positioning-ui.test.tsx src/features/creation/creation-ui.test.tsx src/features/reviews/review-ui.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 列表态统一两行摘要，完整正文只在详情页显示**

```tsx
<p className="candidate-card__summary line-clamp-2" data-testid="candidate-summary">{candidate.matchExplanation}</p>
<p className="task-card__steps line-clamp-2">{task.steps.join(" · ")}</p>
```

- [ ] **Step 4: AI 状态仅渲染数据库事实**

```tsx
const statusCopy = run.status === "processing"
  ? "请求已保存，AI 正在处理"
  : run.status === "failed"
    ? "生成失败，可使用原输入重试"
    : "结果已保存";
```

Run: `pnpm.cmd vitest run src/features/positioning src/features/creation src/features/reviews`

Expected: PASS。

- [ ] **Step 5: 提交三条主流程视觉深化**

```powershell
git add src/features/positioning src/features/creation src/features/reviews src/app/globals.css
git commit -m "style: tighten core creator workflows"
```

### Task 5: 任务、素材、报告和我的统一图标与状态

**Files:**
- Modify: `src/features/tasks/task-card.tsx`
- Modify: `src/features/tasks/task-preview.tsx`
- Modify: `src/features/materials/material-picker.tsx`
- Modify: `src/features/reports/report-list.tsx`
- Modify: `src/app/(product)/materials/page.tsx`
- Modify: `src/app/(product)/reports/page.tsx`
- Modify: `src/app/(product)/me/page.tsx`
- Modify: `src/app/(product)/me/profile/page.tsx`
- Modify: `src/components/domain-components.test.tsx`

**Interfaces:**
- Consumes: `REPORT_ICONS`, `TASK_SOURCE_ICONS`, 现有 actions。
- Produces: 所有记录类型一致图标、状态标签和真实详情链接。

- [ ] **Step 1: 写失败测试，要求任务与报告展示来源图标和中文状态**

```tsx
test("task and report records expose source labels", () => {
  render(<TaskCard task={taskFixture} onComplete={() => undefined} />);
  expect(screen.getByLabelText("来源：定位报告")).toBeInTheDocument();
  render(<ReportList items={[reportFixture]} />);
  expect(screen.getByText("已完成")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行组件测试，确认来源图标契约失败**

Run: `pnpm.cmd vitest run src/components/domain-components.test.tsx`

Expected: FAIL。

- [ ] **Step 3: 使用统一映射渲染来源和报告类型**

```tsx
const sourceLabel = { positioning: "定位报告", creation: "创作方案", review: "复盘报告" }[task.sourceType];
<span aria-label={`来源：${sourceLabel}`} className="record-source"><SourceIcon aria-hidden="true" size={16} />{sourceLabel}</span>
```

- [ ] **Step 4: 素材新增表单默认折叠，档案编辑继续追加版本**

```tsx
<details className="compact-disclosure">
  <summary>新建素材</summary>
  <MaterialForm action={createMaterialAction} />
</details>
```

Run: `pnpm.cmd vitest run src/components/domain-components.test.tsx src/features/tasks src/features/materials src/features/reports && pnpm.cmd typecheck`

Expected: PASS。

- [ ] **Step 5: 提交记录型页面**

```powershell
git add src/features/tasks src/features/materials src/features/reports 'src/app/(product)/materials/page.tsx' 'src/app/(product)/reports/page.tsx' 'src/app/(product)/me' src/components/domain-components.test.tsx
git commit -m "style: unify record and profile modules"
```

### Task 6: 手机视觉回归与无障碍验收

**Files:**
- Modify: `tests/e2e/visual.spec.ts`
- Modify: `tests/e2e/helpers.ts`
- Create: `tests/e2e/mobile-product.spec.ts`

**Interfaces:**
- Consumes: 完整手机前台。
- Produces: 360×800、390×844、412×915 的可复现截图和溢出断言。

- [ ] **Step 1: 写三视口失败测试**

```ts
for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
  test(`workspace fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/workspace");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator(".app-shell")).toHaveScreenshot(`workspace-${viewport.width}.png`, { animations: "disabled" });
  });
}
```

- [ ] **Step 2: 在测试数据库启动后运行并记录旧截图差异**

Run: `$env:E2E_DATABASE_URL=$env:TEST_DATABASE_URL; pnpm.cmd e2e -- tests/e2e/mobile-product.spec.ts`

Expected: 首次 FAIL，生成待审截图。

- [ ] **Step 3: 修正剩余溢出、焦点和底栏遮挡，只改 CSS 或对应展示组件**

```css
@media (max-width: 430px) {
  .compact-grid { grid-template-columns: minmax(0, 1fr); }
  .app-sticky-footer { bottom: calc(62px + env(safe-area-inset-bottom)); }
}
:focus-visible { outline: 2px solid var(--cc-accent); outline-offset: 2px; }
```

- [ ] **Step 4: 跑手机前台完整验证**

Run: `pnpm.cmd vitest run src/components src/features/workspace src/features/positioning src/features/creation src/features/reviews src/features/tasks src/features/materials src/features/reports && pnpm.cmd lint && pnpm.cmd typecheck`

Expected: 全部 PASS，lint 和 typecheck 0 errors。

- [ ] **Step 5: 提交手机端验收**

```powershell
git add src tests/e2e
git commit -m "test: verify complete mobile product experience"
```
