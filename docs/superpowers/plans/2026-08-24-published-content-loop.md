# Published Content Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the real creation-to-review gap with an Owner-scoped published-content record connected to immutable plans, metric snapshots, reports, and next actions.

**Architecture:** Add one aggregate between content-plan versions and reviews. Existing review records may attach to one published content; external content creates the same aggregate without a plan. No new bottom navigation item is added.

**Tech Stack:** Next.js 16, React 19, Drizzle ORM, PostgreSQL, Zod, Vitest, Playwright.

## Global Constraints

- Preserve the four-tab and five-tool Figma information architecture.
- A published record references an immutable creation plan version when it originated in Creator Compass.
- Multiple metric snapshots attach to one continuous review; duplicate submissions remain idempotent.
- All queries are Owner-scoped.

---

### Task 1: Add published-content schema and review relationship

**Files:**
- Modify: `src/server/db/schema/product.ts`
- Create: `drizzle/0018_published_contents.sql`
- Test: `src/server/db/schema/schema.test.ts`

**Interfaces:**
- Produces: `publishedContents`, nullable `reviews.publishedContentId`.

- [ ] **Step 1: Write a failing schema test for plan provenance, external content, and unique Owner identity**
- [ ] **Step 2: Run the schema test and verify missing table failure**
- [ ] **Step 3: Add the table and migration**

```ts
export const publishedContents = pgTable("published_contents", {
  id: uuid("id").defaultRandom().primaryKey(),
  ...actorColumns,
  contentPlanId: uuid("content_plan_id").references(() => contentPlans.id, { onDelete: "restrict" }),
  platformAccountId: uuid("platform_account_id").references(() => platformAccounts.id, { onDelete: "restrict" }),
  platform: text("platform").notNull(),
  finalTitle: text("final_title").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  contentUrl: text("content_url"),
  sourceKind: text("source_kind").notNull(),
  ...timestamps,
});
```

- [ ] **Step 4: Add checks for `source_kind in ('creation','external')`, required/null plan pairing, and composite Owner-scoped foreign keys for plan/platform/review relationships; run schema tests**
- [ ] **Step 5: Commit `feat: add published content aggregate`**

### Task 2: Implement idempotent publication service

**Files:**
- Create: `src/features/content/publication-service.ts`
- Create: `src/features/content/publication-service.test.ts`
- Create: `src/features/content/publication-actions.ts`

**Interfaces:**
- Produces: `publishPlan(actor, input)`, `createExternalContent(actor, input)`, `listReviewableContent(actor)`, `getPublishedContent(actor, id)`.

- [ ] **Step 1: Write tests for immutable plan ownership, normalized optional URL, and duplicate idempotency key**

```ts
const first = await publishPlan(actor, { contentPlanId, platform, finalTitle: "最终标题", publishedAt, idempotencyKey: "publish-v1" }, repo);
const second = await publishPlan(actor, { contentPlanId, platform, finalTitle: "最终标题", publishedAt, idempotencyKey: "publish-v1" }, repo);
expect(second.id).toBe(first.id);
```

- [ ] **Step 2: Run the focused test and verify missing module failure**
- [ ] **Step 3: Implement Zod validation, Owner locks, source checks, and transactional insert**
- [ ] **Step 4: Run tests and `pnpm.cmd typecheck`; verify pass**
- [ ] **Step 5: Commit `feat: record published creator content`**

### Task 3: Add publication and review-selection UI

**Files:**
- Modify: `src/app/(product)/creation/[projectId]/plan/page.tsx`
- Create: `src/features/content/publish-content-sheet.tsx`
- Create: `src/features/content/publish-content-sheet.test.tsx`
- Modify: `src/app/(product)/reviews/new/page.tsx`
- Modify: `src/features/reviews/ocr-confirmation.tsx`
- Modify: `src/features/reviews/review-service.ts`
- Test: `src/features/reviews/review-service.test.ts`

**Interfaces:**
- Consumes: publication service from Task 2.
- Produces: review creation with optional required-valid `publishedContentId`.

- [ ] **Step 1: Write UI tests for “标记为已发布”, compact fields, existing-content prefill, and external-content entry**
- [ ] **Step 2: Run the UI and review tests and verify failure**
- [ ] **Step 3: Add a compact bottom sheet to the plan page and a content selector to review creation**
- [ ] **Step 4: Make review creation lock the selected content, prefill platform/title/time, and reuse the existing continuous review**
- [ ] **Step 5: Run `pnpm.cmd vitest run src/features/content src/features/reviews`; verify pass**
- [ ] **Step 6: Commit `feat: connect published content to review`**

### Task 4: Drive the workspace from real unreviewed content

**Files:**
- Modify: `src/features/workspace/workspace-service.ts`
- Modify: `src/features/workspace/next-action-service.ts`
- Test: `src/features/workspace/workspace-service.test.ts`
- Test: `src/features/workspace/next-action-service.test.ts`
- Modify: `tests/e2e/creator-loop.spec.ts`

**Interfaces:**
- Produces: real `publishedWithoutReview` projection and `/reviews/new?source=<publishedContentId>` navigation.

- [ ] **Step 1: Replace the test fixture's hard-coded state with a repository result and assert the next-action link**
- [ ] **Step 2: Run workspace tests and confirm failure because production still assigns `null`**
- [ ] **Step 3: Query the oldest Owner-owned published content without a review and pass it to `resolveNextAction`**
- [ ] **Step 4: Add the E2E path: generate plan → publish → workspace → prefilled review → report → tasks**
- [ ] **Step 5: Run workspace tests and Playwright against isolated PostgreSQL; verify pass**
- [ ] **Step 6: Commit `feat: close creation publication review loop`**
