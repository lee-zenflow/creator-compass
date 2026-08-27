# Local Backup, Runtime, and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a maintainable Windows-local product with private filesystem storage, seven automatic snapshots, portable encrypted backup, safe factory reset/update, truthful documentation, and full visual/E2E release gates.

**Architecture:** Docker volumes replace S3. A maintenance service coordinates PostgreSQL logical dumps and file manifests. Portable archives use scrypt plus AES-256-GCM; restores validate before writes and create a rollback snapshot.

**Tech Stack:** Docker Compose, PowerShell, Node crypto/streams, PostgreSQL tools, Next.js, Playwright, Vitest, GitHub Releases.

## Global Constraints

- Primary support: Windows 10/11 with Docker Desktop.
- Only the app maps a host port, bound to `127.0.0.1`.
- Automatic snapshots retain exactly seven successful versions.
- Portable backups exclude DeepSeek Key, master key, passwords, sessions, and recovery codes.
- GitHub contains only MIT source, scripts, documentation, and labeled samples.

---

### Task 1: Make local filesystem storage the only production storage

**Files:**
- Modify: `src/server/storage/storage.ts`
- Modify: `src/server/storage/local-storage.ts`
- Remove: `src/server/storage/s3-storage.ts`
- Remove: S3 tests and AWS dependencies
- Modify: `package.json`
- Modify: `.env.example`
- Test: `src/server/storage/local-storage.test.ts`

**Interfaces:**
- Produces: `getPrivateStorage()` backed only by `LOCAL_STORAGE_PATH` inside the mounted private volume.

- [ ] **Step 1: Write tests for atomic create, Owner prefix, traversal rejection, range-safe download, and deletion**
- [ ] **Step 2: Run storage tests and verify missing local-only factory behavior**
- [ ] **Step 3: Move the factory to local storage, remove S3 code/dependencies/configuration, and keep explicit loopback production assertion**
- [ ] **Step 4: Run storage/security tests and `pnpm.cmd install --lockfile-only`; verify no AWS package remains**
- [ ] **Step 5: Commit `refactor: use local private storage only`**

### Task 2: Implement snapshot and portable backup services

**Files:**
- Create: `src/server/maintenance/backup-crypto.ts`
- Create: `src/server/maintenance/backup-crypto.test.ts`
- Create: `src/server/maintenance/backup-service.ts`
- Create: `src/server/maintenance/backup-service.test.ts`
- Create: `src/server/maintenance/backup-manifest.ts`
- Create: `src/app/api/maintenance/backups/route.ts`
- Create: `src/app/(product)/me/backups/page.tsx`

**Interfaces:**
- Produces: `createAutomaticSnapshot()`, `createPortableBackup(password)`, `inspectBackup(path,password)`, `restoreBackup(path,password)`.

- [ ] **Step 1: Write crypto tests for scrypt round-trip, random salt/IV, wrong password, and tamper rejection**
- [ ] **Step 2: Write service tests for manifest hashes, secret-table exclusion, seven-version rotation, pre-restore snapshot, and rollback**
- [ ] **Step 3: Run focused tests and verify missing modules fail**
- [ ] **Step 4: Implement a versioned binary envelope and authenticated manifest**

```ts
export type BackupManifest = { formatVersion: 1; productVersion: string; createdAt: string; files: Array<{ path: string; bytes: number; sha256: string }> };
```

- [ ] **Step 5: Implement maintenance-mode dump/file staging, validation-before-write, and rollback-on-failure**
- [ ] **Step 6: Add compact backup UI and run maintenance tests; commit `feat: add encrypted local backup and snapshots`**

### Task 3: Add factory reset, local analytics retention, and controlled update state

**Files:**
- Create: `src/server/maintenance/factory-reset.ts`
- Create: `src/server/maintenance/factory-reset.test.ts`
- Create: `src/server/maintenance/update-service.ts`
- Create: `src/server/maintenance/update-service.test.ts`
- Modify: `src/app/(product)/me/settings/page.tsx`
- Modify: analytics retention service/tests

**Interfaces:**
- Produces: `factoryReset(owner,password,confirmation)`, `checkReleaseOnDemand()`, `pruneLocalAnalytics(90)`, update journal states.

- [ ] **Step 1: Write tests proving wrong confirmation changes nothing, reset deletes all sensitive/local business data but preserves model cache, and telemetry never performs network I/O**
- [ ] **Step 2: Run focused tests and verify failure**
- [ ] **Step 3: Implement transactional reset preparation, file cleanup journal, and return to uninitialized state**
- [ ] **Step 4: Implement manual-only GitHub release check and update journal; scripts consume the journal after creating a snapshot**
- [ ] **Step 5: Run tests and commit `feat: add local maintenance controls`**

### Task 4: Replace Compose topology and Windows scripts

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.production.yml`
- Modify: `Dockerfile`
- Modify: `scripts/start-local-product.ps1`
- Modify: `启动 Creator Compass.cmd`
- Modify: `停止 Creator Compass.cmd`
- Create: `检查 Creator Compass.cmd`
- Create: `备份 Creator Compass.cmd`
- Create: `scripts/check-local-product.ps1`
- Create: `scripts/backup-local-product.ps1`
- Test: `src/server/release/open-source-contract.test.ts`

**Interfaces:**
- Produces: app/worker/postgres-pgvector/embedding topology and Chinese one-click operations.

- [ ] **Step 1: Extend contract tests to reject Mailpit, MinIO, S3, public DB ports, mutable production tags, and missing healthchecks**
- [ ] **Step 2: Run release contract tests and verify current Compose fails**
- [ ] **Step 3: Update Compose with named database/private/model/secret/snapshot volumes, internal healthchecks, and `127.0.0.1:${APP_PORT:-3000}:3000` only**
- [ ] **Step 4: Make start script check Docker Desktop, generate non-secret defaults/master-key volume, migrate, wait for health, and open the browser; errors remain visible in Chinese**
- [ ] **Step 5: Run YAML parse, Compose config, script syntax, and contract tests; commit `build: ship local-only Docker runtime`**

### Task 5: Perform full product, visual, and release verification

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Replace: `docs/backup-restore.md`
- Modify: `docs/deployment.md`
- Modify: `scripts/verify-release.ps1`
- Modify/Create: Playwright E2E and screenshot specs under `tests/e2e`

**Interfaces:**
- Produces: a reproducible release gate and user-facing local installation documentation.

- [ ] **Step 1: Add E2E for initialization, recovery code, BYOK status, positioning, creation, publish, review, next tasks, offline views, RAG hybrid/degraded states, backup restore, and factory reset**
- [ ] **Step 2: Add screenshot assertions for 360×800, 390×844, 412×915 and desktop admin; verify long content does not enlarge 64/84/148px rows**
- [ ] **Step 3: Update docs to state local-only access, no telemetry, no OAuth/payment/email/URL fetch/scanned-PDF OCR, and BYOK privacy**
- [ ] **Step 4: Run `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test`, real Docker `pnpm.cmd e2e`, `pnpm.cmd build`, worker build, Compose health, secret scan, backup restore, and migration rollback**
- [ ] **Step 5: Inspect all generated screenshots manually and record defects; fix owning components and rerun affected scenarios**
- [ ] **Step 6: Confirm repository contains no private documents, `.env` secrets, volumes, databases, backups, or model weights**
- [ ] **Step 7: Commit `docs: finalize local product release` and create a versioned release candidate tag only after every gate passes**

