# AI operations

## Runtime boundaries

- The Owner provides the DeepSeek Key in the in-product settings page. It is encrypted locally and resolved only inside worker execution. The fixed model is `deepseek-v4-flash`; environment-variable API keys and model overrides are not supported.
- A producer starts pg-boss and creates the queues before opening the business transaction. The run, guest quota update, and job insert then share one Drizzle transaction.
- Each task queue uses pg-boss `singleton` policy with a HMAC owner key, `retryLimit: 0`, and a 300-second job timeout. A failed request is shown to the Owner for explicit manual retry; the worker never performs a hidden second model call.
- Queue payloads contain only `aiRunId`. Prompts, source material, model output, API keys, and raw upstream errors are not job or application-log fields.
- `pnpm worker` bootstraps queue infrastructure, consumes the four implemented flow queues, writes a database heartbeat, runs retention cleanup, and handles graceful shutdown.

## Incremental migration note

Migration `0003_mixed_zaladane.sql` backfills pre-existing AI rows with `legacy:<id>` idempotency keys. Its subject check is installed `NOT VALID` so an upgrade does not reject legacy rows that predate business-subject columns. Before a later `VALIDATE CONSTRAINT ai_runs_task_subject_match`, backfill each legacy row with its positioning session, creation project, or review ID and verify the task-type mapping.

## Retention

Operational AI and retrieval metadata expires after its configured retention window only when no formal positioning, creation, or review report references it. The cleanup query never deletes lineage that belongs to a formal report.
