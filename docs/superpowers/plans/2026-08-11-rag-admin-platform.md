# Creator Compass RAG 与运营后台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可实际导入 URL、PDF、DOCX、TXT 和手动文本的审核知识库，并让管理员在桌面后台完成来源、切片、审核、检索验证、规则和异常任务管理。

**Architecture:** 知识入库使用独立 `knowledge_ingestion_jobs` 状态机与 pg-boss 队列，不混入用户 AI run。安全抓取、文本解析、确定性切片和 DeepSeek 标签各自为独立模块；来源与切片双重审核后才进入 PostgreSQL 标签 + trigram + FTS 混合检索。

**Tech Stack:** PostgreSQL、Drizzle ORM、pg_trgm、pg-boss、MinIO/S3、Undici、ipaddr.js、pdfjs-dist、mammoth、DeepSeek、Zod、Next.js、Vitest、Playwright。

## Global Constraints

- 单文件最大 10 MiB；URL 响应最大 8 MiB、15 秒超时、最多 3 次重定向。
- URL 仅允许 HTTP/HTTPS；阻止环回、私网、链路本地、云元数据地址；每次 DNS 与重定向都重新校验。
- 仅解析 HTML、TXT、PDF、DOCX；不执行宏、脚本或嵌入对象。
- 切片目标 600 字符、最少 300、最多 800、固定重叠 100 字符。
- 来源和切片必须同时 approved、production、非 Demo 且 enabled 才能生产检索。
- 单次召回最多 8 条；itemId/sourceId 必须来自本次 retrieval 快照。
- 后台只允许已验证且 active 的 admin 用户访问；不显示私密用户输入。

---

## File Map

- `src/server/db/schema/product.ts`：知识来源、切片、入库任务与索引。
- `src/server/knowledge/ingestion-contracts.ts`：入库输入、状态和错误码。
- `src/server/knowledge/safe-fetch.ts`：SSRF 防护和受限下载。
- `src/server/knowledge/extract-text.ts`：HTML/TXT/PDF/DOCX 文本提取。
- `src/server/knowledge/chunk-text.ts`：确定性切片。
- `src/server/knowledge/tag-knowledge.ts`：DeepSeek 结构化摘要和候选标签，不做审核决定。
- `src/server/knowledge/ingestion-service.ts`：提交、状态、审核和事务。
- `src/workers/knowledge-worker.ts`：消费入库任务并推进状态。
- `src/server/search/retrieve-knowledge.ts`：生产混合检索。
- `src/components/admin/*`：桌面后台布局和表格。

### Task 1: 知识入库数据模型与增量迁移

**Files:**
- Modify: `src/server/db/schema/product.ts`
- Modify: `src/server/db/schema/schema.test.ts`
- Modify: `src/server/db/migration.test.ts`
- Create: `drizzle/0014_knowledge_ingestion.sql`
- Create: `drizzle/meta/0014_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `knowledgeIngestionJobs` 表；`knowledgeSources.objectKey/originalMime/fetchStatus/licenseNote/failureCode/processedAt`；`knowledgeItems.chunkIndex/charStart/charEnd/reviewNote/enabled`。

- [ ] **Step 1: 写失败 schema 测试**

```ts
test("knowledge ingestion has review-safe state and searchable chunks", () => {
  expect(knowledgeIngestionJobs).toBeDefined();
  expect(getTableConfig(knowledgeItems).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["chunk_index", "char_start", "char_end", "enabled"]));
});
```

- [ ] **Step 2: 运行 schema 测试确认失败**

Run: `pnpm.cmd vitest run src/server/db/schema/schema.test.ts src/server/db/migration.test.ts`

Expected: FAIL，`knowledgeIngestionJobs` 未定义。

- [ ] **Step 3: 增加 schema 定义**

```ts
export const knowledgeIngestionJobs = pgTable("knowledge_ingestion_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => knowledgeSources.id, { onDelete: "cascade" }),
  submittedByUserId: uuid("submitted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  inputKind: text("input_kind").$type<"url" | "file" | "text">().notNull(),
  status: text("status").$type<"queued" | "fetching" | "parsing" | "tagging" | "pending_review" | "failed">().notNull(),
  attempt: integer("attempt").default(0).notNull(),
  failureCode: text("failure_code"),
  safeFailureDetail: text("safe_failure_detail"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("knowledge_ingestion_jobs_status_idx").on(table.status, table.createdAt)]);
```

同时在 `knowledgeSources` 增加 `objectKey`、`originalMime`、`fetchStatus`、`licenseNote`、`failureCode`、`processedAt`；删除仅按 `name` 的唯一索引，改为普通名称索引与 `(sourceType, contentHash)` 唯一索引，允许不同来源使用相同标题。

- [ ] **Step 4: 生成迁移后手工确保历史回填与 trigram 索引顺序正确**

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE "knowledge_items" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "knowledge_items" ADD COLUMN "chunk_index" integer DEFAULT 0 NOT NULL;
ALTER TABLE "knowledge_items" ADD COLUMN "char_start" integer DEFAULT 0 NOT NULL;
ALTER TABLE "knowledge_items" ADD COLUMN "char_end" integer DEFAULT 0 NOT NULL;
DROP INDEX "knowledge_sources_name_idx";
CREATE INDEX "knowledge_sources_name_idx" ON "knowledge_sources" ("name");
CREATE UNIQUE INDEX "knowledge_sources_type_hash_idx" ON "knowledge_sources" ("source_type", "content_hash");
CREATE INDEX "knowledge_items_search_trgm_idx" ON "knowledge_items" USING gin ("searchable_text" gin_trgm_ops);
```

Run: `pnpm.cmd db:generate && pnpm.cmd vitest run src/server/db/schema/schema.test.ts src/server/db/migration.test.ts`

Expected: PASS，且只新增 0014。

- [ ] **Step 5: 提交迁移**

```powershell
git add src/server/db/schema drizzle
git commit -m "feat: add knowledge ingestion schema"
```

### Task 2: 入库契约与安全 URL 获取

**Files:**
- Create: `src/server/knowledge/ingestion-contracts.ts`
- Create: `src/server/knowledge/safe-fetch.ts`
- Create: `src/server/knowledge/safe-fetch.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `KnowledgeIngestionInput`, `KnowledgeIngestionFailureCode`, `safeFetchKnowledgeUrl(url, deps)`。

- [ ] **Step 1: 安装解析与网络安全依赖**

Run: `pnpm.cmd add undici ipaddr.js pdfjs-dist mammoth`

Expected: package.json 与 pnpm-lock.yaml 更新成功。

- [ ] **Step 2: 写 SSRF、重定向、超时和大小限制失败测试**

```ts
const privateDeps: SafeFetchDependencies = {
  resolveAll: async () => ["127.0.0.1"],
  requestOnce: vi.fn(),
};

function createRedirectFixture(locations: string[]): SafeFetchDependencies {
  let index = 0;
  return {
    resolveAll: async () => ["93.184.216.34"],
    requestOnce: vi.fn(async () => ({
      status: 302,
      headers: new Headers({ location: locations[index++] ?? "/done" }),
      body: null,
    })),
  };
}

test.each(["http://127.0.0.1/a", "http://169.254.169.254/latest/meta-data", "http://[::1]/a"])("blocks private target %s", async (url) => {
  await expect(safeFetchKnowledgeUrl(url, privateDeps)).rejects.toThrow("URL_PRIVATE_ADDRESS");
});

test("rejects a fourth redirect", async () => {
  const deps = createRedirectFixture(["/1", "/2", "/3", "/4"]);
  await expect(safeFetchKnowledgeUrl("https://example.com/0", deps)).rejects.toThrow("URL_TOO_MANY_REDIRECTS");
});
```

- [ ] **Step 3: 定义严格输入与错误码**

```ts
export const knowledgeIngestionInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), name: z.string().trim().min(1).max(160), url: z.string().url(), licenseNote: z.string().trim().min(1).max(1000) }),
  z.object({ kind: z.literal("file"), name: z.string().trim().min(1).max(160), objectKey: z.string().min(1), mime: z.enum(["text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]), size: z.number().int().positive().max(10 * 1024 * 1024), licenseNote: z.string().trim().min(1).max(1000) }),
  z.object({ kind: z.literal("text"), name: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(200_000), licenseNote: z.string().trim().min(1).max(1000) }),
]);
```

- [ ] **Step 4: 实现手动重定向与地址校验**

```ts
export const FETCH_LIMITS = { timeoutMs: 15_000, maxRedirects: 3, maxBytes: 8 * 1024 * 1024 } as const;

export type SafeFetchDependencies = {
  resolveAll(hostname: string): Promise<string[]>;
  requestOnce(url: URL, validatedAddresses: string[], signal: AbortSignal): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> | null }>;
};

export function assertPublicAddress(address: string) {
  const range = ipaddr.process(address).range();
  if (range !== "unicast") throw new Error("URL_PRIVATE_ADDRESS");
}
```

每次请求前解析全部 DNS 地址并调用 `assertPublicAddress`，然后把这组已验证地址交给 Undici 自定义 `lookup` 完成当次连接，禁止请求阶段再次独立解析；每次 3xx 都重新解析新 URL；流式读取超过 `maxBytes` 立即取消。

Run: `pnpm.cmd vitest run src/server/knowledge/safe-fetch.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交安全抓取边界**

```powershell
git add package.json pnpm-lock.yaml src/server/knowledge
git commit -m "feat: add safe knowledge source fetching"
```

### Task 3: 文本提取与确定性切片

**Files:**
- Create: `src/server/knowledge/extract-text.ts`
- Create: `src/server/knowledge/extract-text.test.ts`
- Create: `src/server/knowledge/chunk-text.ts`
- Create: `src/server/knowledge/chunk-text.test.ts`

**Interfaces:**
- Produces: `extractKnowledgeText({ mime, bytes }) -> Promise<string>`；`chunkKnowledgeText(text) -> KnowledgeChunk[]`。

- [ ] **Step 1: 写四种格式和切片边界失败测试**

```ts
test("chunks Chinese paragraphs deterministically", () => {
  const chunks = chunkKnowledgeText("第一段。".repeat(120) + "\n\n" + "第二段。".repeat(120));
  expect(chunks.every((chunk) => chunk.text.length >= 300 && chunk.text.length <= 800)).toBe(true);
  expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
  expect(chunkKnowledgeText(input)).toEqual(chunks);
});
```

- [ ] **Step 2: 运行测试确认函数不存在**

Run: `pnpm.cmd vitest run src/server/knowledge/extract-text.test.ts src/server/knowledge/chunk-text.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现解析分派**

```ts
export async function extractKnowledgeText(input: { mime: SupportedKnowledgeMime; bytes: Uint8Array }) {
  if (input.mime === "text/plain") return new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  if (input.mime === "application/pdf") return extractPdfText(input.bytes);
  if (input.mime === DOCX_MIME) return (await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) })).value;
  if (input.mime === "text/html") return stripHtmlWithoutScripts(new TextDecoder().decode(input.bytes));
  throw new Error("UNSUPPORTED_CONTENT_TYPE");
}
```

- [ ] **Step 4: 实现固定切片参数**

```ts
export const CHUNK_POLICY = { target: 600, min: 300, max: 800, overlap: 100 } as const;
export type KnowledgeChunk = { index: number; charStart: number; charEnd: number; text: string };
```

按标题和空行分段；不足 300 与下一段合并；超过 800 在中文标点处截断；下一片从上片末尾前 100 字符开始。

Run: `pnpm.cmd vitest run src/server/knowledge/extract-text.test.ts src/server/knowledge/chunk-text.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交解析器与切片器**

```powershell
git add src/server/knowledge/extract-text* src/server/knowledge/chunk-text*
git commit -m "feat: extract and chunk knowledge documents"
```

### Task 4: 入库服务、队列和 worker

**Files:**
- Create: `src/server/knowledge/ingestion-service.ts`
- Create: `src/server/knowledge/ingestion-service.test.ts`
- Create: `src/server/knowledge/tag-knowledge.ts`
- Create: `src/server/knowledge/tag-knowledge.test.ts`
- Create: `src/workers/knowledge-worker.ts`
- Create: `src/workers/knowledge-worker.test.ts`
- Modify: `src/workers/ai-worker.ts`
- Modify: `src/workers/ai-worker.test.ts`
- Modify: `src/server/jobs/queues.ts`

**Interfaces:**
- Produces: `enqueueKnowledgeIngestion(actor, input)`、`processKnowledgeIngestion(jobId)`、`reviewKnowledgeSource`、`reviewKnowledgeItem`、`setKnowledgeItemEnabled`。

- [ ] **Step 1: 写失败测试，验证事务、去重和双重审核**

```ts
test("duplicate content hash reuses the existing source", async () => {
  const first = await service.enqueue(admin, textInput);
  const second = await service.enqueue(admin, textInput);
  expect(second.sourceId).toBe(first.sourceId);
  expect(repository.insertSource).toHaveBeenCalledTimes(1);
});

test("item cannot enter production before source approval", async () => {
  await expect(service.reviewItem(admin, itemId, "approved")).rejects.toThrow("SOURCE_NOT_APPROVED");
});
```

- [ ] **Step 2: 运行 service/worker 测试确认失败**

Run: `pnpm.cmd vitest run src/server/knowledge/ingestion-service.test.ts src/workers/knowledge-worker.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现状态机与队列负载**

```ts
export const KNOWLEDGE_INGEST_QUEUE = "knowledge-ingest";
export const knowledgeJobPayloadSchema = z.object({ ingestionJobId: z.string().uuid() });

export const knowledgeTagSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  normalizedKeywords: z.array(z.string().trim().min(1).max(60)).max(30),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  platform: z.string().trim().max(40).nullable(),
  contentType: z.string().trim().max(40).nullable(),
});

export async function enqueueKnowledgeIngestion(actor: CurrentActor, input: KnowledgeIngestionInput) {
  assertAdmin(actor);
  return db.transaction(async (tx) => {
    const record = await createPendingSourceAndJob(tx, input);
    await getBoss(tx).send(KNOWLEDGE_INGEST_QUEUE, { ingestionJobId: record.jobId }, { retryLimit: 1 });
    return record;
  });
}
```

`ensureAiQueueInfrastructure` 同时创建 `knowledge-ingest` 队列；`runAiWorkerBootstrap` 在同一个已启动的 PgBoss 实例上注册知识消费者，关闭时仍由原有 worker 统一停止 boss 与数据库连接。

```ts
const boss = getBoss();
worker = await startAiWorker(aiHandlers, databaseAiWorkerRepository, boss);
await startKnowledgeWorker(boss);
```

- [ ] **Step 4: worker 按 fetching → parsing → tagging → pending_review 推进，并安全失败**

```ts
try {
  await markJob(jobId, "fetching");
  const document = await loadKnowledgeInput(jobId);
  await markJob(jobId, "parsing");
  const text = await extractKnowledgeText(document);
  const chunks = chunkKnowledgeText(text);
  await markJob(jobId, "tagging");
  const tagged = await tagChunksWithDeepSeek(chunks);
await persistPendingChunks(jobId, tagged);
} catch (error) {
  await markJobFailed(jobId, toSafeIngestionFailure(error));
  throw error;
}
```

Run: `pnpm.cmd vitest run src/server/knowledge src/workers/knowledge-worker.test.ts src/server/jobs/queues.test.ts && pnpm.cmd typecheck`

Expected: PASS。

- [ ] **Step 5: 提交入库闭环**

```powershell
git add src/server/knowledge src/workers/knowledge-worker* src/workers/ai-worker* src/server/jobs/queues*
git commit -m "feat: process knowledge ingestion jobs"
```

### Task 5: 中文混合检索与回归集

**Files:**
- Modify: `src/server/search/retrieve-knowledge.ts`
- Modify: `src/server/search/retrieve-knowledge.test.ts`
- Create: `src/server/search/knowledge-regression-fixtures.ts`

**Interfaces:**
- Consumes: `knowledgeItems.enabled/searchableText` 与 `pg_trgm`。
- Produces: 标签、trigram、substring、FTS 的稳定 top-8；保持现有 `KnowledgeHit` 接口。

- [ ] **Step 1: 写连续中文、停用、未审核和稳定排序失败测试**

```ts
test("continuous Chinese query can retrieve an approved matching chunk", async () => {
  const hits = await retrieveKnowledge({ platform: "xiaohongshu", contentType: "note", tags: [], keywords: ["个人IP定位"] }, chineseRepository);
  expect(hits[0]?.id).toBe("expected-approved-item");
});

test.each(["pending", "rejected", "disabled", "demo", "development_only"])("never returns %s fixtures", async (fixture) => {
  expect((await runRegressionQuery(fixture)).some((hit) => hit.id === fixture)).toBe(false);
});
```

- [ ] **Step 2: 运行检索测试确认中文查询失败**

Run: `pnpm.cmd vitest run src/server/search/retrieve-knowledge.test.ts`

Expected: FAIL，连续中文未命中。

- [ ] **Step 3: 下推混合排名与生产闸门**

```ts
const trigramRank = sql<number>`greatest(similarity(${knowledgeItems.searchableText}, ${searchDocument}), case when ${knowledgeItems.searchableText} ilike ${`%${searchDocument}%`} then 1 else 0 end)`;
const itemDatabaseRank = sql<number>`(case when ${tagMatch} then 5 else 0 end) + (${trigramRank} * 4) + ${ftsRank}`;
```

查询 WHERE 同时要求 item/source approved、production、非 Demo、`knowledge_items.enabled = true`；排序为 rank DESC、item ID ASC；最终仍切到 8 条。

- [ ] **Step 4: 跑检索与 AI 引用测试**

Run: `pnpm.cmd vitest run src/server/search src/server/ai src/features/positioning/positioning-ai-processor.test.ts src/features/creation/creation-ai-processor.test.ts src/features/reviews/review-ai-processor.test.ts`

Expected: PASS，现有 citation pair 校验无回归。

- [ ] **Step 5: 提交中文检索**

```powershell
git add src/server/search
git commit -m "feat: add Chinese hybrid knowledge retrieval"
```

### Task 6: 桌面运营后台壳与知识页面

**Files:**
- Create: `src/components/admin/admin-shell.tsx`
- Create: `src/components/admin/admin-shell.test.tsx`
- Create: `src/components/admin/admin-table.tsx`
- Modify: `src/features/admin/admin-service.ts`
- Modify: `src/features/admin/admin-service.test.ts`
- Modify: `src/features/admin/admin-actions.ts`
- Create: `src/app/(product)/admin/layout.tsx`
- Modify: `src/app/(product)/admin/page.tsx`
- Modify: `src/app/(product)/admin/knowledge/page.tsx`
- Create: `src/app/(product)/admin/knowledge/[sourceId]/page.tsx`
- Create: `src/app/(product)/admin/retrieval/page.tsx`
- Create: `src/app/api/admin/knowledge/uploads/route.ts`
- Create: `src/server/knowledge/upload-route.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: 240px 桌面侧栏、来源/切片/审核/检索页面；移动端用户 AppShell 不受影响。

- [ ] **Step 1: 写后台导航和权限失败测试**

```tsx
test("admin shell exposes all operational modules", () => {
  render(<AdminShell title="知识来源"><p>内容</p></AdminShell>);
  for (const label of ["知识概览", "知识来源", "审核队列", "检索试验", "平台规则", "提示词", "AI 异常"]) expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行后台组件和 service 测试确认失败**

Run: `pnpm.cmd vitest run src/components/admin src/features/admin`

Expected: FAIL。

- [ ] **Step 3: 建立桌面壳和统一图标菜单**

```tsx
export const ADMIN_NAV = [
  ["知识概览", "/admin", LayoutDashboard],
  ["知识来源", "/admin/knowledge", BookOpenText],
  ["审核队列", "/admin/knowledge?view=review", BadgeCheck],
  ["检索试验", "/admin/retrieval", Search],
  ["平台规则", "/admin/rules", Scale],
  ["提示词", "/admin/prompts", Braces],
  ["AI 异常", "/admin/ai-runs", TriangleAlert],
] as const;
```

- [ ] **Step 4: 补齐来源详情、切片审核和检索试验 action**

```ts
export async function testKnowledgeRetrievalAction(form: FormData) {
  const actor = await adminActor();
  assertAdmin(actor);
  return retrieveKnowledge({
    platform: text(form, "platform"),
    contentType: text(form, "contentType"),
    tags: csv(form, "tags"),
    keywords: csv(form, "keywords"),
  });
}
```

文件上传路由必须先通过 `adminActor`，使用 `file-policy.ts` 校验 10 MiB 与 MIME，再写入私有对象存储并调用 `enqueueKnowledgeIngestion`；响应只返回 `sourceId` 和 `jobId`，不返回对象键。

```ts
const file = form.get("file");
if (!(file instanceof File)) return Response.json({ code: "FILE_REQUIRED" }, { status: 400 });
assertKnowledgeUpload({ name: file.name, mime: file.type, size: file.size });
const result = await storeAndEnqueueKnowledgeFile(actor, file);
return Response.json({ sourceId: result.sourceId, jobId: result.jobId }, { status: 202 });
```

Run: `pnpm.cmd vitest run src/components/admin src/features/admin && pnpm.cmd typecheck`

Expected: PASS。

- [ ] **Step 5: 提交桌面后台**

```powershell
git add src/components/admin src/features/admin 'src/app/(product)/admin' src/app/globals.css
git commit -m "feat: add desktop knowledge operations console"
```

### Task 7: RAG 真实数据库与后台端到端验收

**Files:**
- Create: `src/server/knowledge/ingestion-service.integration.test.ts`
- Modify: `tests/e2e/helpers.ts`
- Create: `tests/e2e/admin-knowledge.spec.ts`
- Modify: `docs/ai-operations.md`

**Interfaces:**
- Consumes: 完整入库、审核、检索和后台。
- Produces: URL/文件/文本三条真实入库证据与生产闸门测试。

- [ ] **Step 1: 写集成测试：入库、双审、检索、停用**

```ts
test("approved source and item become retrievable then disappear when disabled", async () => {
  const source = await ingestText(admin, fixtureText);
  await approveSource(admin, source.id);
  await approveItem(admin, source.itemIds[0]);
  expect(await retrieveFixture()).toContainEqual(expect.objectContaining({ sourceId: source.id }));
  await setItemEnabled(admin, source.itemIds[0], false);
  expect(await retrieveFixture()).toEqual([]);
});
```

- [ ] **Step 2: 在 TEST_DATABASE_URL 上运行并确认未实现路径失败**

Run: `$env:TEST_DATABASE_URL=$env:DATABASE_URL; pnpm.cmd vitest run src/server/knowledge/ingestion-service.integration.test.ts`

Expected: 初次 FAIL。

- [ ] **Step 3: 修正真实事务、对象存储和队列边界，不在测试中绕过审核**

```ts
if (!process.env.TEST_DATABASE_URL) test.skip("requires TEST_DATABASE_URL", () => undefined);
```

只允许缺少测试数据库时跳过；CI 必须设置 TEST_DATABASE_URL。

- [ ] **Step 4: 运行 RAG 全量验证**

Run: `pnpm.cmd vitest run src/server/knowledge src/server/search src/features/admin && pnpm.cmd lint && pnpm.cmd typecheck && pnpm.cmd build && pnpm.cmd build:worker`

Expected: 全部 PASS，两个 build exit 0。

- [ ] **Step 5: 提交 RAG 验收与运维文档**

```powershell
git add src/server/knowledge tests/e2e/admin-knowledge.spec.ts tests/e2e/helpers.ts docs/ai-operations.md
git commit -m "test: verify governed rag ingestion and retrieval"
```
