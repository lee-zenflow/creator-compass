# Creator Compass C 阶段：RAG 质量与可解释运维 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员能判断知识库是否健康、为什么召回某条资料，并让用户只看到真实可读的引用依据，而不泄露内部调试信息。

**Architecture:** 保留 PostgreSQL trigram、substring 和 FTS 混合检索，不引入向量数据库。检索核心新增纯解释对象，生产返回仍是受审核的最小命中；后台读模型聚合质量指标和失败作业，用户引用通过本次 `retrievalRecord` 快照解析，避免引用漂移。

**Tech Stack:** Next.js 16、React 19、TypeScript、Drizzle ORM、PostgreSQL pg_trgm/FTS、Zod、Vitest、Playwright。

## Global Constraints

- 生产检索必须同时满足来源 approved+production+非 demo，以及条目/规则 approved+production+enabled+非 demo。
- 同一来源最多 3 条，总命中最多 8 条。
- 不新增向量数据库、搜索微服务或伪造案例。
- 业务 AI 输入只包含已通过门禁的可信片段，不包含内部权重、过滤原因或管理员备注。
- 用户引用只能来自当前 run 的 retrieval snapshot，必须校验 `(itemId, sourceId)` 对。
- 无命中时明确显示“仅基于本次输入，暂无匹配案例依据”。
- 失败日志和页面只显示固定安全码，不保存或展示原始私密 query。
- 只有确实无法从现有字段计算的指标才允许新增数据库字段。

---

## File Map

- `src/server/search/retrieval-explanation.ts`：纯评分分解和过滤原因。
- `src/server/search/retrieve-knowledge.ts`：生产门禁、排序、来源去重和 explain 模式。
- `src/features/admin/knowledge-quality-service.ts`：知识库质量聚合。
- `src/components/admin/retrieval-lab.tsx`：Top 8、贡献项和过滤统计。
- `src/features/citations/*`：本次快照引用解析和用户可读呈现。
- `src/workers/knowledge-worker.ts`：临时/永久失败分类与安全恢复。

### Task 1: 建立纯检索解释模型

**Files:**
- Create: `src/server/search/retrieval-explanation.ts`
- Create: `src/server/search/retrieval-explanation.test.ts`
- Modify: `src/server/search/retrieve-knowledge.ts`
- Modify: `src/server/search/retrieve-knowledge.test.ts`

**Interfaces:**
- Produces: `RetrievalSignal`、`RetrievalExplanation`、`explainCandidate(candidate,input)`。

- [ ] **Step 1: 写评分贡献和拒绝原因测试**

```ts
const result = explainCandidate(candidate({ tags:["效率"], databaseRank:0.4 }), input({ tags:["效率"], keywords:["复盘"] }));
expect(result.accepted).toBe(true);
expect(result.signals).toEqual(expect.arrayContaining([
  { kind:"exact_tag", value:"效率", contribution:5 },
]));
expect(result.totalScore).toBe(result.signals.reduce((sum, signal) => sum + signal.contribution, 0));
expect(explainCandidate(candidate({ enabled:false }), input()).reasons).toContain("ITEM_DISABLED");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/server/search/retrieval-explanation.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现纯解释对象**

```ts
export type RetrievalSignal = { kind:"base"|"knowledge_bonus"|"database_rank"|"exact_tag"|"substring"|"token"; value?:string; contribution:number };
export type RetrievalRejection = "SOURCE_NOT_APPROVED"|"SOURCE_NOT_PRODUCTION"|"SOURCE_DEMO"|"ITEM_NOT_APPROVED"|"ITEM_NOT_PRODUCTION"|"ITEM_DEMO"|"ITEM_DISABLED"|"OUTSIDE_VALIDITY"|"PLATFORM_MISMATCH"|"CONTENT_TYPE_MISMATCH"|"NO_DETERMINISTIC_MATCH";
export type RetrievalExplanation = { accepted:boolean; signals:RetrievalSignal[]; reasons:RetrievalRejection[]; totalScore:number };

export function explainCandidate(candidate: KnowledgeCandidate, input: NormalizedRetrievalInput, now = new Date()): RetrievalExplanation {
  const reasons = rejectionReasons(candidate,input,now);
  const signals = reasons.length ? [] : scoreSignals(candidate,input);
  return { accepted: reasons.length === 0, reasons, signals, totalScore: signals.reduce((sum,item)=>sum+item.contribution,0) };
}
```

`retrieveKnowledge()` 改为消费 `explainCandidate()` 的 `accepted/totalScore`，删除重复的门禁和评分实现，确保后台解释与生产排序同源。

- [ ] **Step 4: 跑检索回归并提交**

Run: `pnpm.cmd vitest run src/server/search/retrieval-explanation.test.ts src/server/search/retrieve-knowledge.test.ts`

Expected: PASS，排序结果与既有 regression fixtures 一致。

```powershell
git add src/server/search/retrieval-explanation.ts src/server/search/retrieval-explanation.test.ts src/server/search/retrieve-knowledge.ts src/server/search/retrieve-knowledge.test.ts
git commit -m "feat: explain deterministic knowledge retrieval"
```

### Task 2: 提供仅管理员可用的 explain 检索接口

**Files:**
- Modify: `src/server/search/retrieve-knowledge.ts`
- Modify: `src/features/admin/admin-service.ts`
- Modify: `src/features/admin/admin-service.test.ts`
- Modify: `src/features/admin/admin-actions.ts`
- Modify: `src/features/admin/admin-actions.test.ts`

**Interfaces:**
- Produces: `explainKnowledgeRetrieval(input, repository, now)` 和 `AdminRetrievalResult`。

- [ ] **Step 1: 写 admin gate、Top 8 和每源最多 3 条测试**

```ts
await expect(testRetrieval(guestActor, input, repository)).rejects.toThrow("FORBIDDEN");
const result = await testRetrieval(adminActor, input, repository);
expect(result.hits).toHaveLength(8);
expect(Math.max(...Object.values(countBy(result.hits,"sourceId")))).toBeLessThanOrEqual(3);
expect(result.filtered.SOURCE_NOT_APPROVED).toBeGreaterThan(0);
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/admin/admin-service.test.ts src/features/admin/admin-actions.test.ts`

Expected: FAIL，现有结果没有贡献项或过滤统计。

- [ ] **Step 3: 返回管理员专用解释，不改变业务命中类型**

```ts
export type AdminRetrievalResult = {
  hits: Array<KnowledgeHit & { signals: RetrievalSignal[] }>;
  filtered: Partial<Record<RetrievalRejection, number>>;
  candidateCount: number;
};

export async function testKnowledgeRetrieval(actor: CurrentActor, input: RetrievalInput, repository = databaseKnowledgeRepository) {
  assertAdmin(actor);
  return explainKnowledgeRetrieval(input, repository);
}
```

Server action 继续从 FormData 解析平台、内容类型、标签和关键词，不接受调用者传入权重或审核状态。

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/admin/admin-service.test.ts src/features/admin/admin-actions.test.ts src/server/search`

Expected: PASS。

```powershell
git add src/server/search/retrieve-knowledge.ts src/features/admin/admin-service.ts src/features/admin/admin-service.test.ts src/features/admin/admin-actions.ts src/features/admin/admin-actions.test.ts
git commit -m "feat: add admin retrieval explanations"
```

### Task 3: 建立知识库质量总览读模型

**Files:**
- Create: `src/features/admin/knowledge-quality-service.ts`
- Create: `src/features/admin/knowledge-quality-service.test.ts`
- Modify: `src/features/admin/admin-service.ts`
- Modify: `src/app/(product)/admin/knowledge/page.tsx`

**Interfaces:**
- Produces: `KnowledgeQualityOverview` 和 `getKnowledgeQualityOverview(actor)`。

- [ ] **Step 1: 写聚合指标测试**

```ts
expect(await buildQualityOverview(fixtures)).toEqual(expect.objectContaining({
  sources:{ total:4,pending:1,approved:2,production:1,disabled:1,failed:1 },
  chunks:{ total:12,production:6,broken:2 },
  quality:{ blank:1,short:2,long:1,duplicate:2,missingMetadata:3 },
  retrieval:{ eligible:true,sampleSize:30,hitRate:0.8,noHitRate:0.2 },
}));
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/admin/knowledge-quality-service.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 用 SQL 聚合现有字段**

```ts
export type KnowledgeQualityOverview = {
  sources:{ total:number; pending:number; approved:number; production:number; disabled:number; failed:number };
  chunks:{ total:number; production:number; broken:number };
  quality:{ blank:number; short:number; long:number; duplicate:number; missingMetadata:number };
  failedJobs:Array<{ sourceId:string; sourceName:string; code:string; createdAt:Date }>;
  coverage:Array<{ platform:string; contentType:string; count:number }>;
  retrieval:{ eligible:boolean; sampleSize:number; hitRate:number|null; noHitRate:number|null };
};
```

质量规则固定为：归一化正文 `<80` 字为 short、`>800` 字为 long、空白为 blank、相同 `contentHash` 数量大于 1 为 duplicate；缺少 `title/platform/contentType/tags` 任一项计入 missingMetadata；disabled source 指“已有切片且 enabled 切片数为 0”的来源。检索样本少于 30 条时 `eligible=false` 且命中率均为 `null`，达到 30 条后以 `retrievalRecords.hits` 中 `selected=true` 是否存在计算 hit/no-hit。所有计数由数据库完成，页面不拉取全文后再统计。

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/admin/knowledge-quality-service.test.ts src/features/admin/admin-service.test.ts`

Expected: PASS。

```powershell
git add src/features/admin/knowledge-quality-service.ts src/features/admin/knowledge-quality-service.test.ts src/features/admin/admin-service.ts 'src/app/(product)/admin/knowledge/page.tsx'
git commit -m "feat: show knowledge quality health"
```

### Task 4: 深化知识来源详情质量与审核进度

**Files:**
- Modify: `src/features/admin/admin-service.ts`
- Modify: `src/features/admin/admin-service.test.ts`
- Modify: `src/app/(product)/admin/knowledge/[sourceId]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Extends: `AdminKnowledgeSourceDetail.quality` 和 `reviewProgress`。

- [ ] **Step 1: 写来源质量测试**

```ts
expect(detail.quality).toEqual({ characters:1800, chunks:4, averageChunkLength:450, blank:0, short:1, long:0, duplicate:1, missingMetadata:1 });
expect(detail.reviewProgress).toEqual({ reviewed:3, total:4 });
expect(detail.reviewHistory[0]).toMatchObject({ reviewerName:"管理员", reason:"来源许可已确认" });
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/admin/admin-service.test.ts`

Expected: FAIL，详情模型没有 quality/reviewProgress。

- [ ] **Step 3: 聚合质量并以紧凑行展示**

```ts
quality: { characters, chunks: items.length, averageChunkLength: items.length ? Math.round(characters/items.length) : 0, blank, short, long, duplicate, missingMetadata },
reviewProgress: { reviewed: items.filter((item)=>item.reviewStatus !== "pending").length, total: items.length },
```

页面使用 48px 指标行和已有审核历史，不增加大型图表；异常项可过滤到对应切片。

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/features/admin/admin-service.test.ts src/components/admin`

Expected: PASS。

```powershell
git add src/features/admin/admin-service.ts src/features/admin/admin-service.test.ts 'src/app/(product)/admin/knowledge/[sourceId]/page.tsx' src/app/globals.css
git commit -m "feat: inspect source quality and review progress"
```

### Task 5: 升级后台检索实验室

**Files:**
- Modify: `src/components/admin/retrieval-lab.tsx`
- Modify: `src/components/admin/retrieval-lab.test.tsx`
- Modify: `src/app/(product)/admin/retrieval/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `AdminRetrievalResult`。

- [ ] **Step 1: 写 Top 8、贡献项和过滤原因测试**

```tsx
render(<RetrievalLab result={fixtureResult} />);
expect(screen.getAllByTestId("retrieval-hit")).toHaveLength(8);
expect(screen.getByText("标签完全匹配 +5")).toBeInTheDocument();
expect(screen.getByText("来源未通过审核：2")).toBeInTheDocument();
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/components/admin/retrieval-lab.test.tsx`

Expected: FAIL，现有实验室只显示命中摘要。

- [ ] **Step 3: 实现可折叠解释行**

```tsx
{result.hits.map((hit)=><article data-testid="retrieval-hit" key={`${hit.sourceId}:${hit.id}`}>
  <header><strong>{hit.title}</strong><span>{hit.score.toFixed(1)}</span></header>
  <p>{hit.body.slice(0,180)}</p>
  <details><summary>为什么命中</summary>{hit.signals.map(signal=><div key={`${signal.kind}:${signal.value}`}>{signalLabel(signal)}</div>)}</details>
</article>)}
```

后台可以显示 `sourceId/itemId/contentHash`，但这些字段不得进入用户页面或业务 AI prompt。

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/components/admin/retrieval-lab.test.tsx src/features/admin/admin-actions.test.ts`

Expected: PASS。

```powershell
git add src/components/admin/retrieval-lab.tsx src/components/admin/retrieval-lab.test.tsx 'src/app/(product)/admin/retrieval/page.tsx' src/app/globals.css
git commit -m "feat: explain retrieval in admin lab"
```

### Task 6: 把引用解析为用户可读依据

**Files:**
- Create: `src/features/citations/citation-service.ts`
- Create: `src/features/citations/citation-service.test.ts`
- Create: `src/components/ui/citation-list.tsx`
- Create: `src/components/ui/citation-list.test.tsx`
- Modify: `src/features/positioning/positioning-read-service.ts`
- Modify: `src/features/creation/creation-read-service.ts`
- Modify: `src/features/reviews/review-read-service.ts`
- Modify: `src/features/positioning/positioning-ui.tsx`
- Modify: `src/features/creation/creation-ui.tsx`
- Modify: `src/features/reviews/review-ui.tsx`

**Interfaces:**
- Produces: `resolveRunCitations(actor, aiRunId, pairs)` 和 `CitationList`。

- [ ] **Step 1: 写 snapshot pair 与 no-hit 测试**

```ts
await expect(resolveRunCitations(actorA, runB, [{ itemId:"i1",sourceId:"s1" }], repository)).rejects.toThrow("NOT_FOUND");
expect(await resolveRunCitations(actorA, runA, [{ itemId:"forged",sourceId:"s1" }], repository)).toEqual([]);
render(<CitationList citations={[]} />);
expect(screen.getByText("仅基于本次输入，暂无匹配案例依据")).toBeInTheDocument();
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/features/citations/citation-service.test.ts src/components/ui/citation-list.test.tsx`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 只解析本次 retrieval snapshot 中的成对命中**

```ts
export type CitationView = { itemId:string; sourceId:string; title:string; sourceName:string; sourceType:string; summary:string; reviewedAt:Date|null; publicUrl:string|null };
export async function resolveRunCitations(actor:CurrentActor, aiRunId:string, pairs:CitationPair[], repository=databaseCitationRepository) {
  const snapshot = await repository.getActorRunSnapshot(actor, aiRunId);
  if (!snapshot) throw new Error("NOT_FOUND");
  const allow = new Set(snapshot.hits.map((hit)=>`${hit.itemId}:${hit.sourceId}`));
  return repository.resolvePairs(pairs.filter((pair)=>allow.has(`${pair.itemId}:${pair.sourceId}`)));
}
```

`CitationList` 只显示标题、来源类型、一行摘要、审核属性和可选公开 URL；禁止显示 UUID、内部评分或过滤原因。

- [ ] **Step 4: 跑三业务流测试并提交**

Run: `pnpm.cmd vitest run src/features/citations src/components/ui/citation-list.test.tsx src/features/positioning src/features/creation src/features/reviews`

Expected: PASS。

```powershell
git add src/features/citations src/components/ui/citation-list.tsx src/components/ui/citation-list.test.tsx src/features/positioning/positioning-read-service.ts src/features/creation/creation-read-service.ts src/features/reviews/review-read-service.ts src/features/positioning/positioning-ui.tsx src/features/creation/creation-ui.tsx src/features/reviews/review-ui.tsx
git commit -m "feat: show verified user citations"
```

### Task 7: 完善入库失败恢复与不可变历史

**Files:**
- Modify: `src/workers/knowledge-worker.ts`
- Modify: `src/workers/knowledge-worker.test.ts`
- Modify: `src/server/knowledge/ingestion-service.ts`
- Modify: `src/server/knowledge/ingestion-service.test.ts`
- Modify: `src/features/admin/admin-actions.ts`
- Modify: `src/features/admin/admin-actions.test.ts`

**Interfaces:**
- Produces: `retryable` 与 `resubmitRequired` 两种管理员恢复动作。

- [ ] **Step 1: 写临时/永久失败测试**

```ts
expect(classifyKnowledgeFailure(new Error("STORAGE_TIMEOUT"))).toMatchObject({ code:"STORAGE_TIMEOUT", retryable:true });
expect(classifyKnowledgeFailure(new Error("UNSUPPORTED_MIME"))).toMatchObject({ code:"UNSUPPORTED_MIME", retryable:false });
await expect(retryFailedIngestion(admin, permanentJobId)).rejects.toThrow("RESUBMIT_REQUIRED");
```

- [ ] **Step 2: 运行 RED**

Run: `pnpm.cmd vitest run src/workers/knowledge-worker.test.ts src/server/knowledge/ingestion-service.test.ts src/features/admin/admin-actions.test.ts`

Expected: FAIL，至少永久失败仍可直接重试或错误历史会被覆盖。

- [ ] **Step 3: 固定恢复语义**

```ts
export const retryableKnowledgeCodes = new Set(["URL_TIMEOUT","URL_HTTP_ERROR","STORAGE_TIMEOUT","DATABASE_UNAVAILABLE","AI_RATE_LIMITED"]);
export function classifyKnowledgeFailure(error:unknown){ const code=safeKnowledgeCode(error); return { code, retryable:retryableKnowledgeCodes.has(code) }; }
```

重试必须新建 ingestion job，并通过 `parentJobId` 或现有 history 关系保留旧记录；若当前 schema 已能由 sourceId+createdAt 表达历史，则不新增列。原 job 状态和 failureCode 不更新为新结果。

- [ ] **Step 4: 跑测试并提交**

Run: `pnpm.cmd vitest run src/workers/knowledge-worker.test.ts src/server/knowledge src/features/admin`

Expected: PASS。

```powershell
git add src/workers/knowledge-worker.ts src/workers/knowledge-worker.test.ts src/server/knowledge/ingestion-service.ts src/server/knowledge/ingestion-service.test.ts src/features/admin/admin-actions.ts src/features/admin/admin-actions.test.ts
git commit -m "feat: recover knowledge ingestion safely"
```

### Task 8: RAG 回归与发布验证

**Files:**
- Modify: `src/server/search/knowledge-regression-fixtures.ts`
- Create: `tests/e2e/knowledge-operations.spec.ts`
- Modify: `tests/e2e/complete-product.spec.ts`

**Interfaces:**
- Verifies: 双审核门禁、排序解释、每源上限、四类入库、用户引用、无命中、失败恢复和业务闭环。

- [ ] **Step 1: 增加固定检索 fixtures**

```ts
export const knowledgeRegressionCases = [
  { name:"approved exact tag wins", input:{platform:"xiaohongshu",contentType:"article",tags:["复盘"],keywords:[]}, expectedTop:"approved-review-case" },
  { name:"demo is excluded", input:{platform:"xiaohongshu",contentType:"article",tags:["演示"],keywords:[]}, excluded:["demo-item"] },
  { name:"no source dominates", input:{platform:"douyin",contentType:"video",tags:[],keywords:["选题"]}, maxPerSource:3 },
];
```

- [ ] **Step 2: 运行检索回归**

Run: `pnpm.cmd vitest run src/server/search src/server/knowledge src/workers/knowledge-worker.test.ts src/features/admin`

Expected: PASS。

- [ ] **Step 3: 运行真实 PostgreSQL 与 E2E**

Run: `$env:TEST_DATABASE_URL=$env:E2E_DATABASE_URL; pnpm.cmd vitest run src/features/tasks/task-service.integration.test.ts src/features/identity/identity.integration.test.ts`

Run: `pnpm.cmd exec playwright test tests/e2e/knowledge-operations.spec.ts tests/e2e/complete-product.spec.ts --project=chromium`

Expected: PASS；URL/TXT/PDF/DOCX 均可入库，来源和切片未双审时不可被生产召回，管理员解释结果与生产排序一致，业务 AI 输入不含 `signals/reasons/databaseRank/reviewNote`，三业务流无命中时不伪造依据。

- [ ] **Step 4: 跑 C 阶段发布门槛**

Run: `pnpm.cmd lint`

Run: `pnpm.cmd typecheck`

Run: `pnpm.cmd test`

Run: `pnpm.cmd build`

Run: `pnpm.cmd build:worker`

Run: `pnpm.cmd release:verify`

Expected: 全部 exit 0，`/api/health` 的 web/database/worker/storage 全为 healthy，迁移数量与仓库一致。

- [ ] **Step 5: 提交 RAG 验收**

```powershell
git add src/server/search/knowledge-regression-fixtures.ts tests/e2e/knowledge-operations.spec.ts tests/e2e/complete-product.spec.ts
git commit -m "test: verify explainable rag operations"
```
