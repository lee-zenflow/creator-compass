# Compass Instrument Release and Open Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用隔离数据库和三种手机尺寸验证完整产品，补齐 GitHub 开源与生产部署文件，并在不泄露任何密钥的前提下发布。

**Architecture:** 发布验证使用专用端口和一次性测试数据库，不复用开发服务器或开发库。GitHub workflow 只使用测试适配器和临时服务；生产部署从外部注入密钥并通过四组件健康检查。

**Tech Stack:** Playwright、Vitest、GitHub Actions、Docker Compose、Next.js production server、PostgreSQL 16、MinIO、pg-boss

## Global Constraints

- 必须先完成视觉基础、核心流程和 RAG 后台计划。
- E2E 使用 `localhost:3101`、独立数据库和 `AI_ADAPTER=test`；不得使用开发或生产数据库。
- 三视口为 360×800、390×844、412×915。
- GitHub 公开前扫描 `.env.local`、API 密钥、SMTP 凭据、对象存储凭据、测试数据和本地生成缓存。
- 生产环境不得启用 `AI_ADAPTER=test`。

---

## File Map

- `tests/e2e/mobile-viewports.spec.ts`：三尺寸布局和溢出验收。
- `tests/e2e/complete-product.spec.ts`：游客到注册合并的完整闭环。
- `playwright.config.ts`：专用端口、同源 URL 和禁止误复用。
- `scripts/verify-release.ps1`：一次性数据库、迁移、种子、测试和构建。
- `.github/workflows/ci.yml`：开源仓库持续集成。
- `.gitignore`、`.dockerignore`：敏感文件和本地缓存边界。
- `README.md`、`docs/deployment.md`、`SECURITY.md`、`LICENSE`：开源与部署说明。

### Task 1: Lock Three Mobile Viewports with Real Screens

**Files:**
- Modify: `tests/e2e/mobile-viewports.spec.ts`
- Modify: `tests/e2e/mobile-visual-depth.spec.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify only if required by test isolation: `playwright.config.ts`

**Interfaces:**
- Consumes: existing guest helper and deterministic E2E adapter.
- Produces: screenshots and assertions for all three approved viewport sizes.

- [ ] **Step 1: Add the exact viewport matrix**

```ts
const viewports = [
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "412x915", width: 412, height: 915 },
] as const;

for (const viewport of viewports) {
  test(`${viewport.name} keeps the product compact`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await enterAsGuest(page);
    await expect(page).toHaveURL(/\/workspace/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator(".app-shell")).toHaveCSS("width", `${Math.min(viewport.width, 390)}px`);
    await page.screenshot({ path: `artifacts/mobile/${viewport.name}-workspace.png`, fullPage: true });
  });
}
```

- [ ] **Step 2: Run one viewport and verify test isolation**

Run: `pnpm.cmd exec playwright test tests/e2e/mobile-viewports.spec.ts --grep "390x844"`

Expected: one test passes against the isolated E2E service; no existing server is reused.

- [ ] **Step 3: Run all three viewports**

Run: `pnpm.cmd exec playwright test tests/e2e/mobile-viewports.spec.ts tests/e2e/mobile-visual-depth.spec.ts`

Expected: all viewport tests pass and screenshots contain no bottom-nav overlap or horizontal scroll.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/mobile-viewports.spec.ts tests/e2e/mobile-visual-depth.spec.ts tests/e2e/helpers.ts playwright.config.ts
git commit -m "test: verify compass mobile viewports"
```

### Task 2: Re-run the Full Product Journey and Release Gate

**Files:**
- Modify: `tests/e2e/complete-product.spec.ts`
- Modify: `scripts/verify-release.ps1`
- Modify: `src/server/release/e2e-isolation.test.ts`
- Modify: `src/server/release/e2e-isolation.ts`

**Interfaces:**
- Consumes: E2E isolation guard, migrations, seed and existing complete-product helper.
- Produces: existing `assertIsolatedE2eDatabaseUrl(value)` remains the database guard; add `resolveE2eBaseUrl(env)` for the dedicated port.

- [ ] **Step 1: Add failing isolation assertions**

```ts
it("rejects a database name without an e2e suffix", () => {
  expect(() => assertIsolatedE2eDatabaseUrl("postgresql://user:pass@localhost:5432/creator_compass"))
    .toThrow("must end with _e2e, _test, or _testing");
});

it("requires a dedicated product port", () => {
  expect(resolveE2eBaseUrl({ PORT: "3000" })).toBe("http://localhost:3101");
});
```

- [ ] **Step 2: Run the isolation tests and verify RED**

Run: `pnpm.cmd vitest run src/server/release/e2e-isolation.test.ts`

Expected: new unsafe database/port assertions fail before the guard is complete.

- [ ] **Step 3: Implement fail-closed release orchestration**

The PowerShell script must check that `E2E_DATABASE_URL` names a disposable E2E database, stop on every non-zero command, reset the Drizzle ledger and public schema only inside that database, migrate from `0000`, seed, start Web/worker on 3101, run Playwright, then run lint, typecheck, unit tests, production Web build and worker build.

```powershell
if (-not $env:E2E_DATABASE_URL) { throw 'E2E_DATABASE_URL_REQUIRED' }
$env:DATABASE_URL = $env:E2E_DATABASE_URL
$env:APP_URL = 'http://localhost:3101'
$env:NEXT_PUBLIC_APP_URL = $env:APP_URL
$env:AI_ADAPTER = 'test'
$env:PORT = '3101'
```

- [ ] **Step 4: Run the complete isolated journey**

Run: `pnpm.cmd exec playwright test tests/e2e/complete-product.spec.ts`

Expected: guest → positioning → positioning tasks → creation → creation tasks → review → review tasks → register → verify → login merge passes, and task/report counts survive merge.

- [ ] **Step 5: Run the full release command**

Run: `powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1`

Expected: migration, seed, unit, E2E, lint, typecheck, Web build and worker build all exit 0.

- [ ] **Step 6: Commit**

```powershell
git add tests/e2e/complete-product.spec.ts scripts/verify-release.ps1 src/server/release
git commit -m "test: harden isolated release verification"
```

### Task 3: Prepare the Repository for Public GitHub Release

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `SECURITY.md`
- Create: `LICENSE`
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: `pnpm` scripts and release gate from Task 2.
- Produces: a public repository with repeatable setup and no secrets.

- [ ] **Step 1: Write the repository hygiene test**

Create `src/server/release/open-source-contract.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

it("does not track local secrets or generated caches", () => {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" });
  expect(tracked).not.toMatch(/(^|\n)\.env\.local$/);
  expect(tracked).not.toMatch(/(^|\n)\.next-e2e\//);
  expect(tracked).not.toMatch(/(^|\n)artifacts\//);
});

it("documents that the test adapter is forbidden in production", () => {
  expect(readFileSync("docs/deployment.md", "utf8")).toContain("AI_ADAPTER=deepseek");
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `pnpm.cmd vitest run src/server/release/open-source-contract.test.ts`

Expected: FAIL until ignore rules and production documentation are complete.

- [ ] **Step 3: Add CI and public documentation**

The workflow must install pnpm 11 and Node 22, start PostgreSQL/MinIO/Mailpit services, migrate and seed a test database, run lint/typecheck/unit/build/build:worker, and run Playwright only against its own service. Do not place real secrets in the workflow; use test-only high-entropy values in the job environment.

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11.16.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm build:worker
```

README must distinguish local deterministic experience from real DeepSeek, list unsupported platform authorization/payment capabilities, and link deployment/security docs. `SECURITY.md` must direct reports to GitHub private vulnerability reporting and must not invent an email address.

- [ ] **Step 4: Scan tracked files for secret patterns**

Run: `git grep -n -I -E "sk-[A-Za-z0-9]{16,}|DEEPSEEK_API_KEY=[^你的]|SMTP_PASSWORD=.+|AUTH_SECRET=.+" -- . ':!.env.example'`

Expected: no output.

- [ ] **Step 5: Run public-repo verification**

Run: `pnpm.cmd vitest run src/server/release && pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd build && pnpm.cmd build:worker`

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```powershell
git add .github SECURITY.md LICENSE .gitignore .dockerignore .env.example README.md docs/deployment.md src/server/release/open-source-contract.test.ts
git commit -m "chore: prepare creator compass for open source"
```

### Task 4: Deploy and Publish Only After Verification

**Files:**
- Modify only if verification proves drift: `docker-compose.production.yml`
- Modify only if verification proves drift: `Dockerfile`
- Evidence: `docs/release-evidence/2026-08-13.md`

**Interfaces:**
- Consumes: green release gate, external production secrets, chosen GitHub repository and deployment host.
- Produces: a public GitHub repository and a healthy production URL.

- [ ] **Step 1: Record verified evidence**

Create the release evidence document with exact commit SHA, migration count, test totals, three viewport screenshots, production build results and health endpoint results. Do not record environment variable values.

- [ ] **Step 2: Build production images locally**

Run: `docker compose -f docker-compose.production.yml build`

Expected: Web and worker images build without embedding `.env.local`.

- [ ] **Step 3: Start a production-mode smoke environment**

Run: `docker compose -f docker-compose.production.yml up -d`

Expected: `/api/health/web`, `/database`, `/worker`, `/storage` all return healthy; `/api/health` returns 200.

- [ ] **Step 4: Publish to GitHub after user confirms repository visibility and license**

```powershell
git remote -v
git push -u origin codex/creator-compass-mvp
```

Expected: push succeeds with no secret scanning block. Open a pull request into `main`, wait for CI, then merge only when all checks are green.

- [ ] **Step 5: Deploy using external secrets**

Set `AI_ADAPTER=deepseek`, database, storage, email, auth and HMAC secrets in the deployment platform secret manager. Run migrations once, start Web and worker, then repeat the four health checks and one verified-user smoke flow.

- [ ] **Step 6: Commit release evidence**

```powershell
git add docs/release-evidence/2026-08-13.md
git commit -m "docs: record creator compass release evidence"
```
