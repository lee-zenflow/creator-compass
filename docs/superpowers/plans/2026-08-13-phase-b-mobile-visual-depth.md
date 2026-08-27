# Creator Compass B 阶段：移动视觉深化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不放大模块、不改变业务语义的前提下，让 Creator Compass 的手机端更有层次、状态更完整、品牌更统一并满足基本无障碍要求。

**Architecture:** 保持现有 AppShell 和业务 view model，新增少量无状态视觉组件与统一令牌。颜色、图标、骨架、空状态和动效只表达模块与状态，不承载业务真值；所有加载与结果仍来自 Server Component 和数据库。

**Tech Stack:** Next.js 16、React 19、TypeScript、lucide-react、CSS、Vitest、Testing Library、Playwright。

## Global Constraints

- 主画板仍为 390×844，并验证 360×800、390×844、412×915。
- 桌面端只居中手机画板；后台保持桌面信息密度，不套手机壳。
- 定位弱青绿、创作雾蓝、复盘浅沙、任务灰青；错误为克制暗红。
- 图标固定 18px、`strokeWidth=1.8`、32px 小底座；不新增图标库。
- 候选卡约 148px、任务卡约 84px；列表摘要最多两行。
- 不使用大渐变、厚阴影、大 Bento、模拟数据、模拟百分比或预计完成时间。
- 动效 160–220ms，只允许颜色、透明度和最多 1px 位移；支持 `prefers-reduced-motion`。

---

## File Map

- `src/app/globals.css`：视觉令牌、密度、动效和无障碍规则。
- `src/components/ui/*`：骨架、空状态、模块标题和反馈状态。
- `src/components/app-shell/*`：跳转链接、焦点、主导航和桌面居中。
- `src/app/{layout,not-found}.tsx` 与 `src/app/icon.svg`：品牌入口。
- `tests/e2e/mobile-visual-depth.spec.ts`：三视口和无障碍验收。

### Task 1: 固定模块色彩、图标和层级令牌

**Files:**
- Modify: `src/features/navigation/module-icons.ts`
- Modify: `src/components/ui/module-icon.tsx`
- Modify: `src/components/ui/mobile-primitives.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `MODULE_TONES` 和 `ModuleIcon` 的统一 32px 外观。

- [ ] **Step 1: 写失败测试**

```tsx
render(<><ModuleIcon name="positioning" label="定位" /><ModuleIcon name="creation" label="创作" /><ModuleIcon name="review" label="复盘" /></>);
expect(screen.getByLabelText("定位")).toHaveAttribute("data-tone", "positioning");
expect(screen.getByLabelText("创作")).toHaveAttribute("data-tone", "creation");
expect(screen.getByLabelText("复盘")).toHaveAttribute("data-tone", "review");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/components/ui/mobile-primitives.test.tsx`

Expected: FAIL，现有 tone 仍是通用颜色名。

- [ ] **Step 3: 实现语义色映射和令牌**

```ts
export const MODULE_TONES = {
  positioning: "positioning", creation: "creation", review: "review",
  tasks: "task", workspace: "neutral", tools: "neutral",
} as const;
```

```css
:root { --cc-positioning:#397e83; --cc-positioning-soft:#e7f0f1; --cc-creation:#4d7292; --cc-creation-soft:#eaf1f7; --cc-review:#8a6a26; --cc-review-soft:#f6f0df; --cc-task:#506f70; --cc-task-soft:#e8eeee; --cc-danger:#9b4b4b; }
.module-icon { width:32px; height:32px; flex-basis:32px; }
.module-icon[data-tone="positioning"] { color:var(--cc-positioning); background:var(--cc-positioning-soft); }
.module-icon[data-tone="creation"] { color:var(--cc-creation); background:var(--cc-creation-soft); }
.module-icon[data-tone="review"] { color:var(--cc-review); background:var(--cc-review-soft); }
.module-icon[data-tone="task"] { color:var(--cc-task); background:var(--cc-task-soft); }
```

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm.cmd vitest run src/components/ui/mobile-primitives.test.tsx src/components/app-shell`

Expected: PASS。

```powershell
git add src/features/navigation/module-icons.ts src/components/ui/module-icon.tsx src/components/ui/mobile-primitives.test.tsx src/app/globals.css
git commit -m "style: deepen module visual identity"
```

### Task 2: 增加与真实布局同形的骨架屏

**Files:**
- Create: `src/components/ui/compact-skeleton.tsx`
- Create: `src/components/ui/compact-skeleton.test.tsx`
- Create: `src/app/(product)/workspace/loading.tsx`
- Create: `src/app/(product)/positioning/[sessionId]/report/loading.tsx`
- Create: `src/app/(product)/tasks/loading.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `CompactSkeleton({ variant: "workspace" | "candidates" | "tasks" })`。

- [ ] **Step 1: 写结构失败测试**

```tsx
render(<CompactSkeleton variant="workspace" />);
expect(screen.getAllByTestId("skeleton-metric")).toHaveLength(3);
render(<CompactSkeleton variant="candidates" />);
expect(screen.getAllByTestId("skeleton-candidate")).toHaveLength(3);
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/components/ui/compact-skeleton.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现固定高度骨架，不显示通用大 spinner**

```tsx
export function CompactSkeleton({ variant }: { variant: "workspace" | "candidates" | "tasks" }) {
  if (variant === "workspace") return <div aria-label="正在加载工作台" className="compact-skeleton"><div className="skeleton-metrics">{[0,1,2].map((i)=><i data-testid="skeleton-metric" key={i}/>)}</div>{[0,1,2].map((i)=><b key={i}/>)}</div>;
  const count = variant === "candidates" ? 3 : 4;
  return <div aria-label="正在加载" className="compact-skeleton">{Array.from({length:count},(_,i)=><b data-testid={`skeleton-${variant === "candidates" ? "candidate" : "task"}`} key={i}/>)}</div>;
}
```

```css
.compact-skeleton b,.compact-skeleton i { display:block; background:var(--cc-surface-muted); animation:skeleton-pulse 1.2s ease-in-out infinite; }
.compact-skeleton [data-testid="skeleton-candidate"] { height:148px; }
.compact-skeleton [data-testid="skeleton-task"] { height:84px; }
@media (prefers-reduced-motion: reduce) { .compact-skeleton b,.compact-skeleton i { animation:none; } }
```

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/components/ui/compact-skeleton.test.tsx`

Expected: PASS。

```powershell
git add src/components/ui/compact-skeleton.tsx src/components/ui/compact-skeleton.test.tsx 'src/app/(product)/workspace/loading.tsx' 'src/app/(product)/positioning/[sessionId]/report/loading.tsx' 'src/app/(product)/tasks/loading.tsx' src/app/globals.css
git commit -m "style: add compact loading skeletons"
```

### Task 3: 统一空状态和错误状态

**Files:**
- Create: `src/components/ui/compact-empty-state.tsx`
- Create: `src/components/ui/compact-empty-state.test.tsx`
- Modify: `src/features/workspace/workspace-view.tsx`
- Modify: `src/features/positioning/positioning-ui.tsx`
- Modify: `src/features/creation/creation-ui.tsx`
- Modify: `src/features/reviews/review-ui.tsx`
- Modify: `src/app/(product)/tasks/page.tsx`

**Interfaces:**
- Produces: `CompactEmptyState({ icon, title, detail, action })`。

- [ ] **Step 1: 写一图标、一标题、一说明、一动作的测试**

```tsx
render(<CompactEmptyState icon="tasks" title="还没有任务" detail="确认方案后会生成行动任务" action={{ href:"/tools", label:"去工具箱" }} />);
expect(screen.getByLabelText("还没有任务")).toBeInTheDocument();
expect(screen.getByRole("link", { name:"去工具箱" })).toHaveAttribute("href","/tools");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/components/ui/compact-empty-state.test.tsx`

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现组件并替换散落空文案**

```tsx
export function CompactEmptyState({ icon, title, detail, action }: Props) {
  return <section className="compact-empty-state"><ModuleIcon name={icon} label={title}/><span><strong>{title}</strong><small>{detail}</small></span>{action ? <Link href={action.href}>{action.label}</Link> : null}</section>;
}
```

每个页面只提供一个动作；没有业务入口时省略 action，禁止补假内容填满页面。

- [ ] **Step 4: 跑相关测试并提交**

Run: `pnpm.cmd vitest run src/components/ui/compact-empty-state.test.tsx src/features/workspace src/features/positioning/positioning-ui.test.tsx src/features/creation/creation-ui.test.tsx src/features/reviews/review-ui.test.tsx`

Expected: PASS。

```powershell
git add src/components/ui/compact-empty-state.tsx src/components/ui/compact-empty-state.test.tsx src/features/workspace/workspace-view.tsx src/features/positioning/positioning-ui.tsx src/features/creation/creation-ui.tsx src/features/reviews/review-ui.tsx 'src/app/(product)/tasks/page.tsx'
git commit -m "style: unify compact empty states"
```

### Task 4: 锁定候选卡、任务卡和长文密度

**Files:**
- Modify: `src/features/positioning/positioning-ui.tsx`
- Modify: `src/features/positioning/positioning-visual-contract.test.ts`
- Modify: `src/features/tasks/task-card.tsx`
- Modify: `src/features/tasks/task-preview.tsx`
- Modify: `src/features/creation/creation-ui.tsx`
- Modify: `src/features/reviews/review-ui.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Preserves: 完整正文仅在详情页展示；列表只显示两行摘要。

- [ ] **Step 1: 写固定高度和 clamp 失败测试**

```ts
expect(css).toMatch(/\.candidate-card[^}]*height:\s*148px/s);
expect(css).toMatch(/\.task-card[^}]*height:\s*84px/s);
expect(css).toMatch(/-webkit-line-clamp:\s*2/);
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/positioning/positioning-visual-contract.test.ts src/features/creation/creation-visual-contract.test.ts`

Expected: FAIL，至少一类列表卡只有 `min-height` 或未截断。

- [ ] **Step 3: 固定列表态，详情态保持完整**

```css
.candidate-card { height:148px; overflow:hidden; }
.task-card,.task-preview__item { height:84px; overflow:hidden; }
.candidate-card__summary,.task-card__steps,.record-summary { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
.report-detail .record-summary { display:block; overflow:visible; }
```

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/positioning src/features/creation src/features/reviews src/features/tasks`

Expected: PASS。

```powershell
git add src/features/positioning/positioning-ui.tsx src/features/positioning/positioning-visual-contract.test.ts src/features/tasks/task-card.tsx src/features/tasks/task-preview.tsx src/features/creation/creation-ui.tsx src/features/reviews/review-ui.tsx src/app/globals.css
git commit -m "style: keep mobile records compact"
```

### Task 5: 增加品牌入口、404 和页面元数据

**Files:**
- Create: `src/app/icon.svg`
- Create: `src/app/not-found.tsx`
- Create: `src/app/not-found.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `metadata`、品牌 SVG、可返回工作台的 404。

- [ ] **Step 1: 写元数据和 404 失败测试**

```tsx
render(<NotFound />);
expect(screen.getByRole("heading", { name:"页面没有找到" })).toBeInTheDocument();
expect(screen.getByRole("link", { name:"返回工作台" })).toHaveAttribute("href","/workspace");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/app/not-found.test.tsx`

Expected: FAIL，页面不存在。

- [ ] **Step 3: 实现文字标识和 404**

```tsx
export const metadata = { title: { default:"Creator Compass", template:"%s · Creator Compass" }, description:"个人创作者的定位、创作与复盘决策助手" };
export default function NotFound(){ return <main className="brand-state"><span aria-hidden="true">CC</span><h1>页面没有找到</h1><p>这个入口可能已更新。</p><Link href="/workspace">返回工作台</Link></main>; }
```

`icon.svg` 使用 `#397E83` 方位标记与白色 `C`，不使用外部图片或生成式插画。

- [ ] **Step 4: 跑测试和 build 并提交**

Run: `pnpm.cmd vitest run src/app/not-found.test.tsx`

Run: `pnpm.cmd build`

Expected: PASS / exit 0。

```powershell
git add src/app/icon.svg src/app/not-found.tsx src/app/not-found.test.tsx src/app/layout.tsx src/app/globals.css
git commit -m "style: add creator compass brand states"
```

### Task 6: 完成键盘、焦点和克制动效

**Files:**
- Modify: `src/components/app-shell/app-shell.tsx`
- Modify: `src/components/app-shell/app-shell.test.tsx`
- Modify: `src/components/app-shell/bottom-nav.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `#main-content`、跳转链接、可见 `:focus-visible`、reduced motion。

- [ ] **Step 1: 写失败测试**

```tsx
render(<AppShell title="工作台" activeTab="workspace"><button>操作</button></AppShell>);
expect(screen.getByRole("link", { name:"跳到主要内容" })).toHaveAttribute("href","#main-content");
expect(screen.getByRole("main")).toHaveAttribute("id","main-content");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/components/app-shell/app-shell.test.tsx`

Expected: FAIL，缺少跳转链接或 main id。

- [ ] **Step 3: 实现语义与动效规则**

```tsx
<a className="skip-link" href="#main-content">跳到主要内容</a>
<main id="main-content" tabIndex={-1}>{children}</main>
```

```css
:where(a,button,input,textarea,select):focus-visible { outline:2px solid var(--cc-accent); outline-offset:2px; }
.compact-card,.compact-button,.bottom-nav a { transition:color 180ms ease,background-color 180ms ease,opacity 180ms ease,transform 180ms ease; }
.compact-button:active { transform:translateY(1px); }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation-duration:.01ms!important; transition-duration:.01ms!important; } }
```

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/components/app-shell`

Expected: PASS。

```powershell
git add src/components/app-shell/app-shell.tsx src/components/app-shell/app-shell.test.tsx src/components/app-shell/bottom-nav.tsx src/app/globals.css
git commit -m "style: improve mobile accessibility and motion"
```

### Task 7: 三视口视觉回归

**Files:**
- Create: `tests/e2e/mobile-visual-depth.spec.ts`
- Modify: `tests/e2e/mobile-viewports.spec.ts`

**Interfaces:**
- Verifies: 360×800、390×844、412×915，无横向滚动、卡片不过高、键盘焦点、reduced motion、404。

- [ ] **Step 1: 写三视口 Playwright 测试**

```ts
for (const viewport of [{width:360,height:800},{width:390,height:844},{width:412,height:915}]) {
  test(`compact product at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterAsGuest(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await expect(page.getByTestId("current-step")).toBeVisible();
    await expect(page.locator(".candidate-card").first()).toHaveCSS("height","148px");
  });
}
```

- [ ] **Step 2: 运行并修正仅由真实浏览器暴露的视觉问题**

Run: `pnpm.cmd exec playwright test tests/e2e/mobile-visual-depth.spec.ts tests/e2e/mobile-viewports.spec.ts --project=chromium`

Expected: PASS，无 console error、404、横向溢出或大卡。

- [ ] **Step 3: 跑 B 阶段全量门槛并提交**

Run: `pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd test && pnpm.cmd build`

Expected: 全部 exit 0。

```powershell
git add tests/e2e/mobile-visual-depth.spec.ts tests/e2e/mobile-viewports.spec.ts
git commit -m "test: verify compact visual depth"
```
