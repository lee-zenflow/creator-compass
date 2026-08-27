import { sql } from "drizzle-orm";

import { db } from "@/server/db/client";

export type AiRetentionResult = {
  aiRunsDeleted: number;
  retrievalRecordsDeleted: number;
};

export async function cleanupExpiredAiMetadata(now = new Date()): Promise<AiRetentionResult> {
  return db.transaction(async (transaction) => {
    const deletedRuns = await transaction.execute(sql`
      delete from "ai_runs" as ar
      where ar."retention_until" < ${now}
        and not exists (select 1 from "positioning_reports" pr where pr."ai_run_id" = ar."id")
        and not exists (select 1 from "content_plans" cp where cp."ai_run_id" = ar."id")
        and not exists (select 1 from "review_reports" rr where rr."ai_run_id" = ar."id")
      returning ar."id"
    `);
    const deletedRetrieval = await transaction.execute(sql`
      delete from "retrieval_records" as r
      where r."retention_until" < ${now}
        and not exists (select 1 from "positioning_reports" pr where pr."retrieval_record_id" = r."id")
        and not exists (select 1 from "content_plans" cp where cp."retrieval_record_id" = r."id")
        and not exists (select 1 from "review_reports" rr where rr."retrieval_record_id" = r."id")
        and not exists (select 1 from "ai_runs" ar where ar."retrieval_record_id" = r."id")
      returning r."id"
    `);
    return {
      aiRunsDeleted: deletedRuns.rows.length,
      retrievalRecordsDeleted: deletedRetrieval.rows.length,
    };
  });
}
