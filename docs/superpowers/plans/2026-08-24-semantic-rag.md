# Local Semantic RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DeepSeek-dependent tagging and text-only retrieval with offline ingestion, 512-dimensional local embeddings, governed hybrid retrieval, explicit degradation, and source send consent.

**Architecture:** A CPU embedding sidecar serves normalized BGE vectors over the internal Docker network. pgvector stores versioned embeddings; PostgreSQL text retrieval remains available. Reciprocal-rank fusion combines both paths after hard governance filters.

**Tech Stack:** PostgreSQL 16 + pgvector, BAAI/bge-small-zh-v1.5, Python CPU embedding service, Next.js, Drizzle, pg-boss, Vitest.

## Global Constraints

- Files: searchable PDF, DOCX, TXT, and pasted text only; no URL fetch.
- Local extraction, chunking, embedding, review, and search work without DeepSeek.
- Source send consent defaults off.
- Only source-approved, chunk-approved, enabled, production, non-demo, send-enabled chunks enter AI prompts.
- Vector failure produces a visible deterministic-text fallback.

---

### Task 1: Add pgvector and embedding metadata

**Files:**
- Modify: `package.json`
- Modify: `src/server/db/schema/product.ts`
- Create: `drizzle/0019_semantic_rag.sql`
- Test: `src/server/db/schema/schema.test.ts`

**Interfaces:**
- Produces: `knowledgeSources.allowAiSend`, embedding status/model/version; `knowledgeItems.embedding vector(512)` and quality fields.

- [ ] **Step 1: Write failing schema tests for 512 dimensions, default-off consent, and HNSW cosine index**
- [ ] **Step 2: Run schema tests and verify failure**
- [ ] **Step 3: Add `pg_vector`, schema fields, extension SQL, and `vector_cosine_ops` HNSW index**
- [ ] **Step 4: Run migration in isolated PostgreSQL and inspect `pg_indexes`; verify HNSW exists**
- [ ] **Step 5: Commit `feat: add pgvector knowledge schema`**

### Task 2: Add the CPU embedding service and typed client

**Files:**
- Create: `embedding/Dockerfile`
- Create: `embedding/requirements.txt`
- Create: `embedding/app.py`
- Create: `src/server/search/embedding-client.ts`
- Create: `src/server/search/embedding-client.test.ts`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: `EmbeddingClient.embedDocuments(texts): Promise<number[][]>`, `embedQuery(text): Promise<number[]>`, `/health`, `/embed`.

- [ ] **Step 1: Write client tests for 512 finite values, request limits, timeout, and unavailable-service classification**
- [ ] **Step 2: Run the client test and verify missing module failure**
- [ ] **Step 3: Implement a loopback-internal FastAPI service loading `BAAI/bge-small-zh-v1.5`, normalizing vectors, and prefixing queries with `为这个句子生成表示以用于检索相关文章：`**

```py
@app.post("/embed")
def embed(request: EmbedRequest):
    vectors = model.encode(request.texts, normalize_embeddings=True)
    return {"model": MODEL_ID, "dimension": 512, "vectors": vectors.tolist()}
```

- [ ] **Step 4: Build the image, call `/health`, embed one Chinese query, and assert 512 finite values**
- [ ] **Step 5: Run client tests and commit `feat: add local Chinese embedding service`**

### Task 3: Make ingestion offline and governed

**Files:**
- Modify: `src/server/knowledge/ingestion-contracts.ts`
- Modify: `src/server/knowledge/ingestion-service.ts`
- Modify: `src/workers/knowledge-worker.ts`
- Modify: `src/components/admin/knowledge-upload-form.tsx`
- Remove: URL submission and safe-fetch production path
- Test: `src/workers/knowledge-worker.test.ts`
- Test: `src/server/knowledge/ingestion-service.test.ts`

**Interfaces:**
- Consumes: embedding client.
- Produces: offline file/text ingestion with pending review chunks and optional separate DeepSeek enrichment job.

- [ ] **Step 1: Write tests proving no DeepSeek call occurs during ordinary ingestion and unreadable scanned PDFs fail as `EMPTY_DOCUMENT`**
- [ ] **Step 2: Run tests and verify current mandatory tagging path fails the contract**
- [ ] **Step 3: Change worker phases to loading → parsing → chunking → embedding → quality_check → pending_review; persist manual platform/content type/tags**
- [ ] **Step 4: Add pasted-text input and remove URL UI/API acceptance**
- [ ] **Step 5: Keep AI enrichment as an explicit consented job that never changes review state**
- [ ] **Step 6: Run knowledge tests and commit `feat: make knowledge ingestion local first`**

### Task 4: Implement hybrid retrieval and degradation

**Files:**
- Modify: `src/server/search/retrieve-knowledge.ts`
- Create: `src/server/search/rank-fusion.ts`
- Create: `src/server/search/rank-fusion.test.ts`
- Modify: `src/server/search/retrieval-explanation.ts`
- Modify: `src/server/search/retrieval-inspection.ts`
- Test: `src/server/search/retrieve-knowledge.test.ts`

**Interfaces:**
- Produces: `matchMode: 'hybrid' | 'deterministic_text' | 'no_knowledge_hit'`, source caps, stored lexical/vector ranks.

- [ ] **Step 1: Write tests for reciprocal-rank fusion, governance filters, max eight hits, max three per source, and embedding failure fallback**

```ts
expect(reciprocalRankFusion([{ id: "a", rank: 1 }], [{ id: "b", rank: 1 }, { id: "a", rank: 2 }], 60)[0]?.id).toBe("a");
```

- [ ] **Step 2: Run retrieval tests and verify hybrid expectations fail**
- [ ] **Step 3: Add vector candidate query using cosine distance and fuse it with existing text candidates after hard filters**
- [ ] **Step 4: Persist retrieval mode, ranks, source version, item hash, and degradation reason**
- [ ] **Step 5: Run search and processor tests; commit `feat: add governed hybrid knowledge retrieval`**

### Task 5: Add quality review, consent, and operator visibility

**Files:**
- Modify: `src/app/(product)/admin/knowledge/[sourceId]/page.tsx`
- Modify: `src/features/admin/admin-actions.ts`
- Modify: `src/components/admin/retrieval-lab.tsx`
- Create: `src/features/admin/knowledge-quality.ts`
- Test: admin component and service tests

**Interfaces:**
- Produces: quality summary, mandatory sample set, anomaly list, guarded batch approval, send-consent control, and visible retrieval mode.

- [ ] **Step 1: Write tests for first/middle/last sampling, anomaly exclusion, batch approval guard, and default-off consent**
- [ ] **Step 2: Run admin tests and verify failure**
- [ ] **Step 3: Implement deterministic quality metrics and guarded batch approval**
- [ ] **Step 4: Render source consent, model/version, embedding progress, hybrid ranks, degradation, and no-hit explanations**
- [ ] **Step 5: Run admin/search tests, typecheck, and lint; commit `feat: add RAG quality operations`**

