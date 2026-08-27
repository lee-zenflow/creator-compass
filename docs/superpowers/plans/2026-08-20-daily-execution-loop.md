# Daily Execution Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn tasks, materials, and report records into a truthful mobile daily-execution loop with atomic batch operations, persistent ordering, usage context, archive/recovery, and responsive verification.

**Architecture:** Keep the existing PostgreSQL aggregate roots and Server Action boundaries. Add owner-scoped repository methods and small read models instead of new tables; perform every multi-record mutation in a transaction and keep the 390px Figma-derived shell compact.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, PostgreSQL 16, Zod 4, Vitest, Testing Library, Playwright, vanilla scoped CSS.

## Global Constraints

- No new npm dependency and no schema migration unless a test proves the existing columns cannot represent the behavior.
- All actor identity comes from the server session or HttpOnly guest cookie; client owner IDs are forbidden.
- Task batch size is 1–50 unique UUIDs and writes are atomic.
- Task ordering changes only within one `plannedDate`; sorting never changes a date.
- `dismissed` tasks are excluded from batch and reorder operations.
- Report archive never deletes versions, tasks, citations, retrieval snapshots, or provenance.
- No email, browser push, calendar sync, OAuth, fake progress, or fake successful action.
- Mobile targets are 360×800, 390×844, and 412×915; interactive targets are at least 42px.
- Preserve current Compass Instrument tokens, 6/8px radii, ~84px task rows, and ~64px material/report rows.
- Every production change follows RED → GREEN and ends with focused tests before the next task.

---

## File Map

- `src/features/tasks/task-schemas.ts`: validates status, batch, and move commands.
- `src/features/tasks/task-service.ts`: owns task transitions, atomic batch mutations, and date-local ordering.
- `src/features/tasks/task-actions.ts`: maps authenticated Server Actions to safe task notices.
- `src/features/tasks/task-list.tsx`: client-only selection state and compact batch footer.
- `src/features/tasks/task-card.tsx`: single task actions, date state, and ordering controls.
- `src/app/(product)/tasks/page.tsx`: server read model, URL filters, and action wiring.
- `src/features/materials/material-read-service.ts`: owner-safe list plus usage summary.
- `src/app/(product)/materials/page.tsx`: search and truthful usage metadata.
- `src/features/reports/report-read-service.ts`: sanitized version detail, citations, and recovery link.
- `src/features/reports/report-service.ts`: archive/restore aggregate-root mutations.
- `src/features/reports/report-actions.ts`: authenticated archive/restore actions.
- `src/app/(product)/reports/page.tsx`: archive filters and detailed version history.
- `src/app/globals.css`: only scoped density, state, and mobile interaction rules.
- `tests/e2e/mobile-viewports.spec.ts`: three-viewport regression.

---

### Task 1: Atomic Task State and Ordering Domain

**Files:**
- Modify: `src/features/tasks/task-schemas.ts`
- Modify: `src/features/tasks/task-service.ts`
- Modify: `src/features/tasks/task-service.test.ts`
- Modify: `src/features/tasks/task-service.integration.test.ts`

**Interfaces:**
- Consumes: `CurrentActor`, existing `TaskRecord`, `TaskRepository.transaction`, and existing `tasks` columns.
- Produces: `startTask(actor, taskId)`, `batchUpdateTaskStatus(actor, input)`, `moveTask(actor, input)`.

- [ ] **Step 1: Write failing schema and domain tests**

Add tests that express the public command shape and transition rules. Reuse the existing in-memory repository test double; extend it with transactional snapshots plus the four locking/mutation methods from Step 4. Define stable UUID fixtures (`firstId`, `secondId`, `thirdId`) and `owner`/`other` actors at the top of the test file so every snippet below compiles without random data:

```ts
test("starts only a pending owned task", async () => {
  const repository = createRepositoryWithTasks([task({ id: firstId, owner, status: "pending" })]);
  await expect(startTask(owner, firstId, repository)).resolves.toMatchObject({ status: "in_progress" });
  await expect(startTask(other, firstId, repository)).rejects.toThrow("NOT_FOUND");
});

test("updates a unique owned batch atomically and treats the target state as idempotent", async () => {
  const repository = createRepositoryWithTasks([
    task({ id: firstId, owner, status: "pending" }),
    task({ id: secondId, owner, status: "completed" }),
  ]);
  const result = await batchUpdateTaskStatus(owner, {
    taskIds: [firstId, secondId, firstId],
    targetStatus: "completed",
  }, repository);
  expect(result.changed.map((item) => item.id)).toEqual([firstId]);
  expect(result.unchanged.map((item) => item.id)).toEqual([secondId]);
});

test("rolls back the whole batch when one task belongs to another actor", async () => {
  const repository = createTransactionalRepository([
    task({ id: firstId, owner, status: "pending" }),
    task({ id: secondId, owner: other, status: "pending" }),
  ]);
  await expect(batchUpdateTaskStatus(owner, {
    taskIds: [firstId, secondId], targetStatus: "completed",
  }, repository)).rejects.toThrow("NOT_FOUND");
  expect(repository.records.find((item) => item.id === firstId)?.status).toBe("pending");
});

test("moves a task only inside its planned date", async () => {
  const repository = createRepositoryWithTasks([
    task({ id: firstId, owner, plannedDate: "2026-08-20", sortOrder: 0 }),
    task({ id: secondId, owner, plannedDate: "2026-08-20", sortOrder: 1 }),
    task({ id: thirdId, owner, plannedDate: "2026-08-21", sortOrder: 0 }),
  ]);
  await moveTask(owner, { taskId: secondId, direction: "up" }, repository);
  expect(await repository.listForDateForUpdate(owner, "2026-08-20"))
    .toMatchObject([{ id: secondId, sortOrder: 0 }, { id: firstId, sortOrder: 1 }]);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
pnpm.cmd vitest run src/features/tasks/task-service.test.ts src/features/tasks/task-service.integration.test.ts
```

Expected: FAIL because the three exported functions and repository methods do not exist.

- [ ] **Step 3: Add exact command schemas**

Add to `task-schemas.ts`:

```ts
export const taskStatusSchema = z.enum(["pending", "in_progress", "completed", "dismissed"]);
export const batchTaskStatusSchema = z.object({
  taskIds: z.array(z.uuid()).min(1).max(50).transform((ids) => [...new Set(ids)]),
  targetStatus: z.enum(["pending", "completed"]),
}).strict();
export const moveTaskSchema = z.object({
  taskId: z.uuid(),
  direction: z.enum(["up", "down"]),
}).strict();
```

- [ ] **Step 4: Add repository locking and mutation methods**

Extend `TaskRepository`:

```ts
getManyForUpdate(actor: CurrentActor, taskIds: string[]): Promise<TaskRecord[]>;
updateManyStatus(actor: CurrentActor, taskIds: string[], status: TaskStatus, completedAt: Date | null): Promise<TaskRecord[]>;
listForDateForUpdate(actor: CurrentActor, plannedDate: string): Promise<TaskRecord[]>;
setSortOrders(actor: CurrentActor, values: Array<{ id: string; sortOrder: number }>): Promise<void>;
```

Database methods must use `actorWhere(actor, tasks)`, `inArray(tasks.id, ids)`, deterministic ordering, and `FOR UPDATE` inside the supplied transaction. `setSortOrders` updates only IDs that already passed the lock/read boundary.

- [ ] **Step 5: Implement transitions and atomic commands**

Add domain functions with these exact rules:

```ts
export async function startTask(actor: CurrentActor, taskId: string, repository = databaseTaskRepository) {
  return repository.transaction(async (transaction) => {
    const [task] = await transaction.getManyForUpdate(actor, [taskIdSchema.parse(taskId)]);
    if (!task) throw new Error("NOT_FOUND");
    if (task.status !== "pending") throw new Error("INVALID_TASK_TRANSITION");
    const updated = await transaction.update(actor, task.id, { status: "in_progress", completedAt: null });
    if (!updated) throw new Error("NOT_FOUND");
    return updated;
  });
}

export async function batchUpdateTaskStatus(actor: CurrentActor, input: unknown, repository = databaseTaskRepository) {
  const parsed = batchTaskStatusSchema.parse(input);
  return repository.transaction(async (transaction) => {
    const locked = await transaction.getManyForUpdate(actor, parsed.taskIds);
    if (locked.length !== parsed.taskIds.length) throw new Error("NOT_FOUND");
    const invalid = locked.some((task) => task.status === "dismissed" || (
      parsed.targetStatus === "pending"
        ? task.status !== "completed" && task.status !== "pending"
        : !["pending", "in_progress", "completed"].includes(task.status)
    ));
    if (invalid) throw new Error("INVALID_TASK_TRANSITION");
    const changed = locked.filter((task) => task.status !== parsed.targetStatus);
    const updated = changed.length === 0 ? [] : await transaction.updateManyStatus(
      actor,
      changed.map((task) => task.id),
      parsed.targetStatus,
      parsed.targetStatus === "completed" ? new Date() : null,
    );
    return { changed: updated, unchanged: locked.filter((task) => task.status === parsed.targetStatus) };
  });
}
```

`moveTask` loads the selected task, locks its same-date list, swaps with the adjacent item, and rewrites contiguous `sortOrder` values. At the first/last boundary it returns the unchanged list.

- [ ] **Step 6: Verify GREEN and integration isolation**

Run the command from Step 2. Expected: PASS. When `TEST_DATABASE_URL` exists, the integration test must also prove cross-owner zero writes and rollback; otherwise it must keep the existing explicit skip behavior.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/features/tasks/task-schemas.ts src/features/tasks/task-service.ts src/features/tasks/task-service.test.ts src/features/tasks/task-service.integration.test.ts
git commit -m "feat: add atomic daily task operations"
```

---

### Task 2: Compact Task Execution UI

**Files:**
- Create: `src/features/tasks/task-list.tsx`
- Create: `src/features/tasks/task-list.test.tsx`
- Modify: `src/features/tasks/task-actions.ts`
- Modify: `src/features/tasks/task-actions.test.ts`
- Modify: `src/features/tasks/task-card.tsx`
- Modify: `src/features/tasks/task-card.test.tsx`
- Modify: `src/app/(product)/tasks/page.tsx`
- Modify: `src/features/tasks/task-visual-contract.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 1 commands and existing `TaskCard` source links.
- Produces: URL-restorable range/status filters, compact selection mode, start/complete/restore, and move controls.

- [ ] **Step 1: Write failing action and component tests**

```tsx
test("keeps batch controls hidden until the user selects a task", async () => {
  render(<TaskList tasks={records} batchAction={batchAction} moveAction={moveAction} toggleAction={toggleAction} />);
  expect(screen.queryByRole("button", { name: "完成所选任务" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /选择.*补充素材/ }));
  expect(screen.getByRole("button", { name: "完成所选任务" })).toBeInTheDocument();
});

test("renders overdue as text and never marks a completed task overdue", () => {
  render(<TaskCard {...pendingYesterday} today="2026-08-20" />);
  expect(screen.getByText("已逾期")).toBeInTheDocument();
  render(<TaskCard {...completedYesterday} today="2026-08-20" />);
  expect(screen.queryAllByText("已逾期")).toHaveLength(1);
});
```

Action tests must assert that form owner IDs are ignored, invalid UUIDs return a fixed notice, and successful writes revalidate `/tasks` plus the detail route.

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm.cmd vitest run src/features/tasks/task-actions.test.ts src/features/tasks/task-card.test.tsx src/features/tasks/task-list.test.tsx src/features/tasks/task-visual-contract.test.ts
```

Expected: FAIL because `TaskList`, batch/move actions, and date-state rendering do not exist.

- [ ] **Step 3: Add authenticated Server Actions**

Implement `startTaskAction`, `batchTaskStatusAction`, and `moveTaskAction`. Parse only `taskId`, repeated `taskIds`, `targetStatus`, and `direction`; resolve actor through `headers()` and `cookies()`. Map errors to `invalid`, `conflict`, or `failed` notices without returning raw messages.

- [ ] **Step 4: Add TaskList selection state**

The client component must cap selection at 50, render checkboxes only in selection mode, submit repeated hidden `taskIds`, and keep one 42px sticky footer with “完成所选任务” or “恢复所选任务”. Use existing task IDs as React keys and form values.

`TaskCard` renders exactly the actions allowed by state: pending → “开始” and “完成”; in_progress → “完成”; completed → “恢复”; dismissed → no state action. Up/down controls are enabled only when an adjacent task exists in the same `plannedDate` group.

- [ ] **Step 5: Wire URL filters and deterministic today**

`tasks/page.tsx` accepts `{ range, status, notice }`, validates both against fixed allowlists, passes them to `listTasks`, and derives `today` once on the server as `YYYY-MM-DD`. Each filter link preserves the other valid filter.

- [ ] **Step 6: Add scoped compact styles**

Keep `.task-card` at 84px, use line clamping, set `.compact-segmented__item { min-height: 42px; }`, and add low-saturation overdue text. Add no `transition: all`, continuous animation, gradient, or card enlargement.

- [ ] **Step 7: Verify GREEN and commit Task 2**

Run Step 2, then:

```powershell
git add src/features/tasks 'src/app/(product)/tasks/page.tsx' src/app/globals.css
git commit -m "feat: add compact daily task controls"
```

---

### Task 3: Material Usage Read Model and Search

**Files:**
- Create: `src/features/materials/material-read-service.ts`
- Create: `src/features/materials/material-read-service.test.ts`
- Modify: `src/app/(product)/materials/page.tsx`
- Modify: `src/features/materials/material-visual-contract.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: existing `MaterialRecord`, `materialReferences`, `creationProjects`, and actor predicates.
- Produces: `listMaterialsWithUsage(actor, filter)` returning each material plus an owner-safe usage summary.

- [ ] **Step 1: Write failing read-model tests**

```ts
test("returns active reference count and the newest owned creation", async () => {
  const rows = await listMaterialsWithUsage(owner, { query: "访谈" }, repository);
  expect(rows[0]).toMatchObject({
    name: "访谈开场素材",
    usage: {
      activeReferenceCount: 2,
      latestCreation: { projectId, title: "完成第一条访谈内容" },
    },
  });
});

test("never includes another actor's references in usage", async () => {
  const rows = await listMaterialsWithUsage(owner, {}, crossOwnerRepository);
  expect(rows[0].usage.activeReferenceCount).toBe(0);
  expect(rows[0].usage.latestCreation).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm.cmd vitest run src/features/materials/material-read-service.test.ts src/features/materials/material-visual-contract.test.ts
```

Expected: FAIL because the read service and usage fields do not exist.

- [ ] **Step 3: Implement the bounded owner-safe read model**

Define:

```ts
export type MaterialWithUsage = MaterialRecord & {
  usage: {
    activeReferenceCount: number;
    latestCreation: null | { projectId: string; title: string; updatedAt: Date };
  };
};
```

First query the actor-owned filtered materials; validate search with `z.string().trim().max(80)`. Query references only for returned material IDs, join actor-owned creation projects, order by project `updatedAt` descending, count only status not equal to `archived`, and use project `goal` as the truthful display title. Merge in memory without N+1 queries.

- [ ] **Step 4: Wire search and metadata into the page**

Add a GET search form named `q`; preserve category in a hidden field. Render source, localized saved date, active reference count, and the latest creation link to `/creation/{projectId}/materials`. Use “尚未用于创作” when null. Keep new-material form collapsed.

- [ ] **Step 5: Verify density and deletion protection**

Tests must assert long source/goal text clamps, record rows remain 64px, links are real, and the existing `MATERIAL_IN_USE` delete test remains green.

- [ ] **Step 6: Commit Task 3**

```powershell
git add src/features/materials 'src/app/(product)/materials/page.tsx' src/app/globals.css
git commit -m "feat: show truthful material usage context"
```

---

### Task 4: Report History, Archive, Citations, and Recovery

**Files:**
- Create: `src/features/reports/report-read-service.ts`
- Create: `src/features/reports/report-read-service.test.ts`
- Create: `src/features/reports/report-actions.ts`
- Create: `src/features/reports/report-actions.test.ts`
- Modify: `src/features/reports/report-service.ts`
- Modify: `src/features/reports/report-service.test.ts`
- Modify: `src/features/reports/report-list.tsx`
- Modify: `src/features/reports/report-list.test.tsx`
- Modify: `src/app/(product)/reports/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: immutable typed versions, `resolveRunCitations`, existing domain detail routes, and existing retry actions.
- Produces: `getReportDetail`, `archiveReport`, `restoreReport`, sanitized version metadata, and a real `recoveryHref`.

- [ ] **Step 1: Write failing archive and read-model tests**

```ts
test("archives only the root and preserves immutable versions", async () => {
  const repository = reportRepositoryWithReadyCreation();
  const archived = await archiveReport(owner, reportId, repository);
  expect(archived.status).toBe("archived");
  expect(repository.versions).toHaveLength(2);
});

test("restores the root to the latest typed version status", async () => {
  const repository = reportRepositoryWithLatestStatus("failed");
  await archiveReport(owner, reportId, repository);
  expect(await restoreReport(owner, reportId, repository)).toMatchObject({ status: "failed" });
});

test("shows recovery only for a real failed run and returns sanitized citations", async () => {
  const detail = await getReportDetail(owner, reportId, repository);
  expect(detail.versions[0]).toMatchObject({
    generationMode: "ai",
    aiStatus: "failed",
    recoveryHref: `/creation/${projectId}/plan`,
  });
  expect(detail.versions[0].citations[0]).not.toHaveProperty("objectKey");
  expect(detail.versions[0].citations[0]).not.toHaveProperty("score");
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
pnpm.cmd vitest run src/features/reports/report-service.test.ts src/features/reports/report-read-service.test.ts src/features/reports/report-actions.test.ts src/features/reports/report-list.test.tsx
```

Expected: FAIL because archive/restore, detailed version provenance, and actions do not exist.

- [ ] **Step 3: Add root status repository mutation**

Extend `ReportRepository` with:

```ts
updateRootStatus(actor: CurrentActor, reportId: string, status: ReportStatus): Promise<ReportRecord | null>;
```

`archiveReport` locks the owned root and sets `archived`. `restoreReport` locks it, reads the latest typed version, and copies that version's real status to the root. Cross-owner IDs return `NOT_FOUND`.

- [ ] **Step 4: Build the sanitized report read model**

Return:

```ts
type ReportDetailVersion = {
  id: string;
  version: number;
  status: ReportStatus;
  createdAt: Date;
  generationMode: "ai" | "manual";
  model: string | null;
  parentVersion: number | null;
  entityId: string;
  citations: CitationView[];
  recoveryHref: string | null;
};
```

For AI versions, resolve only stored exact citation pairs through `resolveRunCitations(actor, retrievalRecordId, pairs)`. Parse each domain at its existing trusted boundary: positioning flattens candidate citation pairs in stored order and de-duplicates exact pairs; creation parses its exact citation array; review reuses `parseStoredReviewCitations`. Legacy review `string[]` citations keep the existing clearly labeled source-level compatibility view and remain non-editable—never invent an `itemId` to upgrade them. Build `recoveryHref` only when the joined owned AI run status is `failed`: positioning → `/positioning/{sessionId}`, creation → `/creation/{projectId}/plan`, review → `/reviews/{reviewId}/report`.

- [ ] **Step 5: Add archive/restore Server Actions and UI**

Actions accept only `reportId`, resolve actor on the server, call the domain service, revalidate `/reports`, and redirect with a fixed `archived`, `restored`, or `failed` notice. The report page defaults to non-archived records, supports `view=archived`, and renders generation mode, timestamps, parent relation, CitationList, real domain link, and conditional recovery link.

- [ ] **Step 6: Verify GREEN and commit Task 4**

Run Step 2, then:

```powershell
git add src/features/reports 'src/app/(product)/reports/page.tsx' src/app/globals.css
git commit -m "feat: add trustworthy report history controls"
```

---

### Task 5: Mobile Integration and Release Verification

**Files:**
- Modify: `src/features/tasks/task-visual-contract.test.ts`
- Modify: `src/features/materials/material-visual-contract.test.ts`
- Modify: `src/features/reports/report-list.test.tsx`
- Modify: `tests/e2e/mobile-viewports.spec.ts`
- Modify: `tests/e2e/complete-product.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1–4 public UI and Server Action behavior.
- Produces: complete three-viewport proof and updated truthful product documentation.

- [ ] **Step 1: Add failing mobile and complete-flow assertions**

For each viewport `{360×800, 390×844, 412×915}` assert:

```ts
await expect(page.locator("body")).toHaveCSS("overflow-x", "hidden");
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
await expect(page.getByRole("navigation", { name: "任务日期筛选" })).toBeVisible();
await expect(page.getByText("已逾期").first()).toBeVisible();
```

Extend the complete flow to start a task, batch-complete tasks, search a material, open its latest creation, archive/restore a report, and verify provenance survives.

- [ ] **Step 2: Run E2E contract in RED state**

Run with an isolated database through:

```powershell
$env:E2E_DATABASE_URL='postgresql://creator_compass:<password>@127.0.0.1:5432/creator_compass_e2e'
powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1
```

Expected before Tasks 1–4: FAIL on the new task/material/report assertions. If PostgreSQL, Mailpit, or object storage is unavailable, record the infrastructure blocker and do not report E2E as passed.

- [ ] **Step 3: Fix only integration defects exposed by E2E**

Do not weaken assertions or use forced clicks. Fix route, accessible-name, pending-state, or responsive CSS defects in their owning files, then rerun the failing scenario.

- [ ] **Step 4: Update truthful documentation**

README must describe application-internal date reminders, batch task controls, material usage context, and report archive/history. It must continue to state that OAuth, automatic sync, push, email reminders, and payment are unsupported.

- [ ] **Step 5: Run final verification**

```powershell
pnpm.cmd vitest run src/features/tasks src/features/materials src/features/reports
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd build:worker
git diff --check
```

Expected: all commands exit 0. Report exact pass/skip counts; a database-backed skip is not release proof.

- [ ] **Step 6: Commit Task 5**

```powershell
git add tests/e2e src/features/tasks src/features/materials src/features/reports 'src/app/(product)/tasks' 'src/app/(product)/materials' 'src/app/(product)/reports' README.md src/app/globals.css
git commit -m "feat: complete daily execution loop"
```
