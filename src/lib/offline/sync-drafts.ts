import type { CurrentActor } from "@/features/identity/current-actor";
import type { DraftRecord } from "./draft-store";

export type RemoteDraft<T extends Record<string, unknown> = Record<string, unknown>> = {
  version: number;
  content: T;
};

export interface DraftSyncRepository {
  getRemote(actor: CurrentActor, entityType: DraftRecord["entityType"], entityId: string): Promise<RemoteDraft | null>;
  save(actor: CurrentActor, draft: DraftRecord): Promise<{ version: number }>;
}

export type DraftSyncResult<T extends Record<string, unknown>> =
  | { kind: "synced"; version: number }
  | { kind: "conflict"; local: DraftRecord<T>; remote: RemoteDraft<T> }
  | { kind: "rejected"; reason: "REMOTE_NOT_FOUND" | "DRAFT_TOO_LARGE" };

export async function syncDraft<T extends Record<string, unknown>>(
  actor: CurrentActor,
  draft: DraftRecord<T>,
  repository: DraftSyncRepository,
): Promise<DraftSyncResult<T>> {
  if (new TextEncoder().encode(JSON.stringify(draft.content)).byteLength > 256 * 1024) {
    return { kind: "rejected", reason: "DRAFT_TOO_LARGE" };
  }
  const remote = await repository.getRemote(actor, draft.entityType, draft.entityId) as RemoteDraft<T> | null;
  if (!remote) return { kind: "rejected", reason: "REMOTE_NOT_FOUND" };
  if (remote.version !== draft.baseVersion) return { kind: "conflict", local: draft, remote };
  const saved = await repository.save(actor, draft);
  return { kind: "synced", version: saved.version };
}
