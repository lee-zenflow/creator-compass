import { randomUUID } from "node:crypto";

import type { CurrentActor } from "@/features/identity/current-actor";
import type { UploadDescriptor } from "@/server/security/file-policy";

export type PrivateUpload = UploadDescriptor & { body: Uint8Array };
export type ByteRange = { start: number; end?: number };

export interface PrivateStorage {
  check(): Promise<void>;
  put(actor: CurrentActor, upload: PrivateUpload): Promise<{ objectKey: string }>;
  get(actor: CurrentActor, objectKey: string, range?: ByteRange): Promise<Uint8Array>;
  delete(actor: CurrentActor, objectKey: string): Promise<void>;
}

export function actorObjectPrefix(actor: CurrentActor) {
  return actor.kind === "user"
    ? `private/user/${actor.userId}/`
    : `private/guest/${actor.guestSessionId}/`;
}

export function buildActorObjectKey(actor: CurrentActor, fileName: string, objectId: string = randomUUID()) {
  const extension = fileName.toLocaleLowerCase("en-US").match(/\.([a-z0-9]+)$/)?.[1] ?? "bin";
  const rawStem = fileName.slice(0, Math.max(0, fileName.length - extension.length - 1));
  const safeStem = rawStem.normalize("NFKC").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "_";
  return `${actorObjectPrefix(actor)}${objectId}-${safeStem}.${extension}`;
}

export function assertActorObjectKey(actor: CurrentActor, objectKey: string) {
  const prefix = actorObjectPrefix(actor);
  const relativeKey = objectKey.slice(prefix.length);
  if (
    !objectKey.startsWith(prefix)
    || !relativeKey
    || relativeKey.includes("/")
    || objectKey.includes("..")
    || objectKey.includes("\\")
  ) throw new Error("FORBIDDEN");
}
