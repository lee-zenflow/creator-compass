# GitHub Bilingual Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the approved bilingual Creator Compass title and description in the README and GitHub About metadata.

**Architecture:** Treat the README opening as a tested public-release contract and GitHub About as external repository metadata. Keep the repository name, URL, product behavior, installation instructions, and capability boundaries unchanged.

**Tech Stack:** Markdown, Vitest, Git, GitHub CLI.

## Global Constraints

- README title must be exactly `Creator Compass｜创作者罗盘`.
- Chinese description must be exactly `本地优先的 AI 创作者工作台，连接 IP 定位、内容策划、数据复盘与下一步行动。`.
- English description must be exactly `A local-first AI workspace connecting creator positioning, content planning, performance review, and next actions.`.
- Repository name remains `creator-compass`.
- Do not claim platform OAuth, public deployment, commercialization, or large-scale validation.
- Do not change application behavior or duplicate the complete README in English.

---

### Task 1: Publish the bilingual repository identity

**Files:**
- Modify: `src/server/release/open-source-contract.test.ts`
- Modify: `README.md`
- Reference: `docs/superpowers/specs/2026-08-28-github-bilingual-positioning-design.md`

**Interfaces:**
- Consumes: the approved title and two descriptions from the design specification.
- Produces: a tested README opening and the same bilingual positioning in GitHub About.

- [ ] **Step 1: Add the failing README contract**

Add these assertions to the existing `documents honest product, AI, legal and deployment boundaries` test immediately after `const readme = read("README.md");`:

```ts
expect(readme.startsWith("# Creator Compass｜创作者罗盘\n")).toBe(true);
expect(readme).toContain("本地优先的 AI 创作者工作台，连接 IP 定位、内容策划、数据复盘与下一步行动。");
expect(readme).toContain("A local-first AI workspace connecting creator positioning, content planning, performance review, and next actions.");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm.cmd vitest run src/server/release/open-source-contract.test.ts
```

Expected: FAIL because the README still starts with `# Creator Compass` and does not contain the approved English description.

- [ ] **Step 3: Replace the README opening with the approved bilingual copy**

The first five lines of `README.md` must become:

```markdown
# Creator Compass｜创作者罗盘

本地优先的 AI 创作者工作台，连接 IP 定位、内容策划、数据复盘与下一步行动。

*A local-first AI workspace connecting creator positioning, content planning, performance review, and next actions.*
```

Keep all following capability and run instructions unchanged.

- [ ] **Step 4: Run focused release verification and verify GREEN**

Run:

```powershell
pnpm.cmd vitest run src/server/release/open-source-contract.test.ts
pnpm.cmd lint
```

Expected: 3 release-contract tests pass and lint exits with code 0.

- [ ] **Step 5: Update GitHub About with the bilingual description**

Run:

```powershell
gh repo edit lee-zenflow/creator-compass --description "本地优先的 AI 创作者工作台：定位、策划、复盘与下一步行动。 / A local-first AI workspace for creator positioning, planning, review, and next actions."
```

Expected: command exits with code 0 without changing the repository name or visibility.

- [ ] **Step 6: Verify local and remote public metadata**

Run:

```powershell
gh repo view lee-zenflow/creator-compass --json name,description,visibility,url
git diff --check
```

Expected: `name` is `creator-compass`, `visibility` is `PUBLIC`, and the description contains both Chinese and English text.

- [ ] **Step 7: Commit and push**

Run:

```powershell
git add README.md src/server/release/open-source-contract.test.ts docs/superpowers/plans/2026-08-28-github-bilingual-positioning.md
git commit -m "docs: add bilingual repository positioning"
git push origin main
```

Expected: `main` pushes successfully and `git status -sb` reports `main...origin/main` with no working-tree changes.
