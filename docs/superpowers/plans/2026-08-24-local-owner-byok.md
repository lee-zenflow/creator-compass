# Local Owner and DeepSeek BYOK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email/guest SaaS identity and shared AI secrets with one local Owner, recovery codes, encrypted DeepSeek BYOK, visible disclosures, and token accounting.

**Architecture:** Keep Better Auth for sessions and password hashing, using the internal synthetic identifier `owner@creator-compass.local` while exposing only a local username. A singleton local-instance row closes registration. A versioned AES-256-GCM envelope resolves the Owner's Key only inside the worker.

**Tech Stack:** Next.js 16, Better Auth 1.6, Drizzle ORM, PostgreSQL 16, Node crypto, pg-boss, Vitest, Playwright.

## Global Constraints

- One Owner only; no guest, email verification, email reset, public registration, or external telemetry.
- DeepSeek only; model is exactly `deepseek-v4-flash`.
- Full API Keys never enter browser persistence, logs, queue payloads, reports, analytics, exports, or backups.
- Existing data is never automatically deleted or merged.
- Use TDD and commit each task independently.

---

### Task 1: Add singleton, recovery, credential, and usage schema

**Files:**
- Modify: `src/server/db/schema/auth.ts`
- Modify: `src/server/db/schema/product.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `drizzle/0017_local_owner_byok.sql`
- Test: `src/server/db/schema/schema.test.ts`

**Interfaces:**
- Produces: `localInstance`, `ownerRecoveryCodes`, `deepseekCredentials`, `aiUsageRecords`.

- [x] **Step 1: Write the failing schema contract**

```ts
expect(getTableConfig(localInstance).columns.map((c) => c.name)).toEqual(
  expect.arrayContaining(["singleton_key", "owner_user_id", "initialized_at", "product_version"]),
);
expect(getTableConfig(deepseekCredentials).columns.map((c) => c.name)).not.toContain("api_key");
expect(getTableConfig(aiUsageRecords).columns.map((c) => c.name)).toEqual(
  expect.arrayContaining(["ai_run_id", "model", "input_tokens", "output_tokens"]),
);
```

- [x] **Step 2: Run `pnpm.cmd vitest run src/server/db/schema/schema.test.ts` and verify imports/tables fail**
- [x] **Step 3: Add the four tables and SQL migration**

```ts
export const deepseekCredentials = pgTable("deepseek_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  envelopeVersion: integer("envelope_version").notNull(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  lastFour: text("last_four").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
  testedAt: timestamp("tested_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});
```

- [x] **Step 4: Run schema tests and `pnpm.cmd exec drizzle-kit check`; verify the checked-in migration count is 18 and no migration-history error is reported**
- [x] **Step 5: Commit `feat: add local owner and BYOK schema`**

### Task 2: Implement versioned credential encryption

**Files:**
- Create: `src/server/security/key-envelope.ts`
- Create: `src/server/security/key-envelope.test.ts`
- Create: `src/server/security/master-key.ts`
- Test: `src/server/security/master-key.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plainText, key): SecretEnvelope`, `decryptSecret(envelope, key): string`, `loadOrCreateMasterKey(path): Promise<Buffer>`.

- [x] **Step 1: Write tests for round-trip, random IVs, tamper rejection, and 0600 key creation**

```ts
const first = encryptSecret("sk-example", key);
const second = encryptSecret("sk-example", key);
expect(first.iv).not.toBe(second.iv);
expect(decryptSecret(first, key)).toBe("sk-example");
expect(() => decryptSecret({ ...first, ciphertext: `${first.ciphertext}A` }, key)).toThrow("SECRET_DECRYPT_FAILED");
```

- [x] **Step 2: Run `pnpm.cmd vitest run src/server/security/key-envelope.test.ts src/server/security/master-key.test.ts`; verify missing modules fail**
- [x] **Step 3: Implement AES-256-GCM with 12-byte IV, 16-byte tag, Base64 fields, and atomic key-file creation**

```ts
const cipher = createCipheriv("aes-256-gcm", key, randomBytes(12));
const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
return { version: 1, ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
```

- [x] **Step 4: Run the focused tests and `pnpm.cmd typecheck`; verify pass**
- [x] **Step 5: Commit `feat: encrypt local provider credentials`**

### Task 3: Replace public registration and guest identity with local initialization

**Files:**
- Modify: `src/lib/auth/auth.ts`
- Modify: `src/features/identity/current-actor.ts`
- Create: `src/features/identity/local-owner-service.ts`
- Create: `src/features/identity/local-owner-service.test.ts`
- Create: `src/app/(auth)/setup/page.tsx`
- Modify: `src/features/identity/auth-ui.tsx`
- Remove: `src/app/api/identity/guest/route.ts`
- Remove: `src/app/api/identity/merge/route.ts`
- Modify: `src/app/page.tsx`
- Test: `src/features/identity/identity-route.test.ts`

**Interfaces:**
- Produces: `getLocalInstanceState()`, `initializeLocalOwner(input)`, `consumeRecoveryCode(input)`.

- [x] **Step 1: Write tests for one Owner, closed registration, synthetic identifier, and one-use recovery code**

```ts
await expect(initializeLocalOwner({ username: "本地创作者", password: "correct-horse-battery" }, repo)).resolves.toMatchObject({ initialized: true });
await expect(initializeLocalOwner({ username: "second", password: "another-password" }, repo)).rejects.toThrow("LOCAL_INSTANCE_INITIALIZED");
await expect(consumeRecoveryCode({ code, password: "replacement-password" }, repo)).resolves.toEqual({ reset: true });
await expect(consumeRecoveryCode({ code, password: "again-password" }, repo)).rejects.toThrow("RECOVERY_CODE_INVALID");
```

- [x] **Step 2: Run focused identity tests and verify old guest/register expectations fail**
- [x] **Step 3: Configure Better Auth without verification/reset mail; create the Owner with `owner@creator-compass.local`, role `admin`, and verified state**
- [x] **Step 4: Render setup/login/recovery pages and make `/register`, `/forgot-password`, `/verify-email`, and guest mutation routes return the setup or login destination without creating data**
- [x] **Step 5: Run `pnpm.cmd vitest run src/features/identity src/app`; verify pass**
- [x] **Step 6: Commit `feat: add single-owner local authentication`**

### Task 4: Add DeepSeek settings and worker-side credential resolution

**Files:**
- Create: `src/features/ai/deepseek-settings-service.ts`
- Create: `src/features/ai/deepseek-settings-service.test.ts`
- Modify: `src/app/(product)/me/settings/page.tsx`
- Create: `src/app/(product)/me/deepseek/page.tsx`
- Modify: `src/server/ai/run-ai-task.ts`
- Modify: `src/server/ai/execute-ai-task.ts`
- Modify: `src/server/ai/deepseek-client.ts`
- Test: `src/server/ai/run-ai-task.test.ts`
- Test: `src/server/ai/deepseek-client.test.ts`

**Interfaces:**
- Produces: `getDeepSeekStatus(userId)`, `saveDeepSeekKey(userId, key, consent)`, `revokeDeepSeekKey(userId)`, `resolveDeepSeekCredential(userId)`.

- [x] **Step 1: Write tests proving queues contain only `aiRunId`, unconfigured users are blocked, and status exposes only last four**

```ts
expect(await getDeepSeekStatus(userId, repo)).toEqual({ configured: true, lastFour: "aa75", testedAt });
expect(JSON.stringify(queue.send.mock.calls)).not.toContain("sk-");
await expect(enqueueAiRun(userActor, input, depsWithoutCredential)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
```

- [x] **Step 2: Run focused tests and verify failure**
- [x] **Step 3: Replace `DEEPSEEK_API_KEY` and `DEEPSEEK_MODEL` enqueue configuration with owner credential status; resolve and decrypt only inside task execution**
- [x] **Step 4: Fix the client model to `deepseek-v4-flash`, parse `usage.prompt_tokens` and `usage.completion_tokens`, and persist `aiUsageRecords`**
- [x] **Step 5: Add test/replace/revoke UI, one-time consent, last-four display, per-run and monthly token totals**
- [x] **Step 6: Run `pnpm.cmd vitest run src/features/ai src/server/ai src/workers`; verify pass**
- [x] **Step 7: Commit `feat: add encrypted DeepSeek BYOK`**

### Task 5: Add persistent send disclosures to all AI entry points

**Files:**
- Create: `src/features/ai/send-disclosure.ts`
- Create: `src/features/ai/send-disclosure.test.ts`
- Create: `src/components/ui/ai-send-disclosure.tsx`
- Modify: positioning, creation, review, and optional knowledge-tagging entry components
- Test: corresponding feature UI tests

**Interfaces:**
- Produces: `buildSendDisclosure(actor, taskType, entityId)` returning core fields, optional materials, allowed knowledge, source names, and chunk counts.

- [x] **Step 1: Write tests that core inputs are mandatory and unapproved or send-disabled knowledge never appears**
- [x] **Step 2: Run feature tests and verify failure**
- [x] **Step 3: Implement the server projection and a compact disclosure above each generation button**

```tsx
<details className="compact-disclosure">
  <summary>本次将发送：{summary}</summary>
  <ul>{sources.map((source) => <li key={source.id}>{source.label} · {source.chunkCount} 个片段</li>)}</ul>
</details>
```

- [x] **Step 4: Run feature tests, typecheck, lint, and secret scan; verify pass**
- [x] **Step 5: Commit `feat: disclose every DeepSeek payload`**
