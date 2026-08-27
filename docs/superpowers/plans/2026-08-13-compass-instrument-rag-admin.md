# Compass Instrument RAG and Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不放宽生产检索闸门的前提下，统一用户可读引用、知识审核历史、检索解释与后台视觉。

**Architecture:** RAG 继续使用 PostgreSQL 混合检索和现有双审核门禁。用户端只消费 retrieval snapshot 允许的引用视图；管理员端消费解释模型和追加式审核事件，不把调试字段暴露给普通用户。

**Tech Stack:** Next.js 16、TypeScript、PostgreSQL/Drizzle、pg-boss、MinIO、Undici、Vitest、Testing Library

## Global Constraints

- 来源与切片必须同时通过审核，且为 production、enabled、非 Demo，才能进入用户生成。
- 同一来源在最终八条结果中最多占三条。
- 引用必须是本次 retrieval snapshot 中的 `itemId/sourceId` 组合。
- 日志和页面不显示密钥、私有对象键、内部网络地址或完整私密输入。
- 本计划不引入新的向量数据库、搜索服务或审核真值字段。

---

## File Map

- `src/features/citations/citation-service.ts`：把可信引用转换成用户可读视图。
- `src/components/ui/citation-list.tsx`：定位、创作和复盘共用展示。
- `src/server/search/retrieve-knowledge.ts`：生产闸门、排序和来源多样性。
- `src/features/admin/admin-service.ts`：后台来源、审核历史和检索解释读模型。
- `src/features/admin/admin-actions.ts`：审核和停用动作。
- `src/app/(product)/admin/*`：桌面后台页面。

### Task 1: Standardize User-Readable Evidence

**Files:**
- Modify: `src/features/citations/citation-service.ts`
- Modify: `src/features/citations/citation-service.test.ts`
- Modify: `src/components/ui/citation-list.tsx`
- Modify: `src/components/ui/citation-list.test.tsx`
- Modify: `src/features/positioning/positioning-ui.tsx`
- Modify: `src/features/creation/creation-ui.tsx`
- Modify: `src/features/reviews/review-ui.tsx`

**Interfaces:**
- Consumes: retrieval record hits and report citation pairs.
- Produces: existing `CitationView = { itemId; sourceId; title; sourceName; sourceType; summary; reviewedAt; publicUrl }` remains the single user-facing evidence type.

- [ ] **Step 1: Write failing citation trust tests**

```ts
it("returns only citation pairs present in the run snapshot", async () => {
  const result = await resolveRunCitations(actor, runId, [
    { itemId: allowedItem, sourceId: allowedSource },
    { itemId: forgedItem, sourceId: allowedSource },
  ], repository);
  expect(result.map((item) => item.itemId)).toEqual([allowedItem]);
});
```

```tsx
it("renders a truthful empty evidence state", () => {
  render(<CitationList citations={[]} emptyDetail="仅基于本次输入，暂无匹配案例依据" />);
  expect(screen.getByText("仅基于本次输入，暂无匹配案例依据")).toBeInTheDocument();
  expect(screen.queryByText(/[0-9a-f]{8}-/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm.cmd vitest run src/features/citations src/components/ui/citation-list.test.tsx`

Expected: FAIL if forged pairs or internal IDs can reach the view.

- [ ] **Step 3: Implement a single citation view boundary**

Parse both the report pairs and retrieval snapshot with Zod, intersect exact pairs, then resolve only the exact item/source pairs already selected in that snapshot. Return no private object key. Reuse `CitationList` in all three flows.

- [ ] **Step 4: Run citations and flow tests**

Run: `pnpm.cmd vitest run src/features/citations src/components/ui/citation-list.test.tsx src/features/positioning src/features/creation src/features/reviews && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all tests pass; all three no-hit messages remain truthful.

- [ ] **Step 5: Commit**

```powershell
git add src/features/citations src/components/ui/citation-list* src/features/positioning/positioning-ui.tsx src/features/creation/creation-ui.tsx src/features/reviews/review-ui.tsx
git commit -m "feat: standardize trusted evidence views"
```

### Task 2: Refine the Admin Knowledge Console

**Files:**
- Modify: `src/features/admin/admin-service.ts`
- Modify: `src/features/admin/admin-service.test.ts`
- Modify: `src/features/admin/admin-actions.ts`
- Modify: `src/features/admin/admin-actions.test.ts`
- Modify: `src/components/admin/admin-shell.tsx`
- Modify: `src/components/admin/admin-table.tsx`
- Modify: `src/components/admin/retrieval-lab.tsx`
- Modify: `src/app/(product)/admin/knowledge/page.tsx`
- Modify: `src/app/(product)/admin/knowledge/[sourceId]/page.tsx`
- Modify: `src/app/(product)/admin/retrieval/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: existing source summary, chunk audit events, retrieval explanations and fixed error codes.
- Produces: no new approval truth; a desktop-only instrument console presentation.

- [ ] **Step 1: Write failing audit and explanation tests**

```ts
it("passes the source rejection reason to the governed service", async () => {
  await reviewKnowledgeSourceAction(form({
    sourceId,
    reviewStatus: "rejected",
    reviewNote: "授权范围无法确认",
  }));
  expect(mocks.reviewSource).toHaveBeenCalledWith(actor, sourceId, "rejected", "授权范围无法确认");
});

it("shows real source names and deterministic signals", () => {
  render(<RetrievalLab initialResult={retrievalResultWithTwoSources} />);
  expect(screen.getAllByTestId("retrieval-hit")).toHaveLength(2);
  expect(screen.getByText("标签完全匹配 定位 +5")).toBeInTheDocument();
  expect(screen.getByText("来源未通过审核：2")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify current behavior**

Run: `pnpm.cmd vitest run src/features/admin src/components/admin src/server/search/retrieve-knowledge.test.ts`

Expected: new presentation/audit assertions fail; existing security gates remain green.

- [ ] **Step 3: Implement desktop instrument presentation**

Keep actions server-side and admin-only. Add status counts, review progress, fixed failure codes, append-only history and explanation signal rows to the read model. Use `admin-shell` scoped CSS; do not apply the 390px user shell to admin pages.

- [ ] **Step 4: Verify admin and retrieval regressions**

Run: `pnpm.cmd vitest run src/features/admin src/components/admin src/server/search src/server/knowledge src/workers/knowledge-worker.test.ts && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all tests pass; pending/development-only sources remain excluded.

- [ ] **Step 5: Commit**

```powershell
git add src/features/admin src/components/admin src/app/\(product\)/admin src/server/search src/app/globals.css
git commit -m "feat: refine knowledge operations console"
```

### Task 3: Re-run the Ingestion Security Boundary

**Files:**
- Modify only if a failing regression proves a defect: `src/server/knowledge/safe-fetch.ts`
- Modify only if a failing regression proves a defect: `src/server/knowledge/extract-text.ts`
- Modify only if a failing regression proves a defect: `src/server/knowledge/ingestion-service.ts`
- Test: `src/server/knowledge/safe-fetch.test.ts`
- Test: `src/server/knowledge/extract-text.test.ts`
- Test: `src/server/knowledge/ingestion-service.test.ts`
- Test: `src/workers/knowledge-worker.test.ts`

**Interfaces:**
- Consumes: existing `SafeFetchFailure`, file policy, private storage and knowledge job error classification.
- Produces: evidence that visual/admin work did not weaken security.

- [ ] **Step 1: Add explicit regression cases**

```ts
it.each(["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1"])(
  "rejects private redirect target %s",
  async (address) => expect(fetchKnowledgeUrl(`http://${address}/secret`, deps)).rejects.toMatchObject({ code: "URL_PRIVATE_ADDRESS" }),
);

it("rejects a DOCX archive whose expanded size exceeds the policy", async () => {
  await expect(extractKnowledgeText(docxBomb, docxMime)).rejects.toMatchObject({ code: "DOCX_UNSAFE_ARCHIVE" });
});
```

- [ ] **Step 2: Run security tests**

Run: `pnpm.cmd vitest run src/server/knowledge src/workers/knowledge-worker.test.ts`

Expected: PASS. If a new test fails, implement only the smallest boundary fix and rerun the same file.

- [ ] **Step 3: Run the complete RAG verification set**

Run: `pnpm.cmd vitest run src/server/knowledge src/server/search src/features/admin src/features/citations src/workers/knowledge-worker.test.ts && pnpm.cmd typecheck && pnpm.cmd lint`

Expected: all commands exit 0.

- [ ] **Step 4: Commit tests or the proven fix**

```powershell
git add src/server/knowledge src/server/search src/workers/knowledge-worker.test.ts
git commit -m "test: lock knowledge ingestion security"
```
