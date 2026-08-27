import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type DraftEntityType = "positioning" | "profile" | "creation" | "review";
export const DRAFT_SUBMISSION_KEY = "creator-compass:submitted-draft";
export type DraftRecord<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  entityType: DraftEntityType;
  entityId: string;
  baseVersion: number;
  content: T;
  updatedAt: string;
  state: "pending";
};

interface DraftDatabase extends DBSchema {
  drafts: {
    key: string;
    value: DraftRecord;
    indexes: { "by-state": string };
  };
}

export class DraftStore {
  private database?: Promise<IDBPDatabase<DraftDatabase>>;

  constructor(private readonly databaseName = "creator-compass-drafts") {}

  private open() {
    this.database ??= openDB<DraftDatabase>(this.databaseName, 1, {
      upgrade(database) {
        const store = database.createObjectStore("drafts", { keyPath: "id" });
        store.createIndex("by-state", "state");
      },
    });
    return this.database;
  }

  async get<T extends Record<string, unknown> = Record<string, unknown>>(id: string) {
    return (await (await this.open()).get("drafts", id)) as DraftRecord<T> | undefined;
  }

  async put<T extends Record<string, unknown>>(draft: DraftRecord<T>) {
    if (new TextEncoder().encode(JSON.stringify(draft.content)).byteLength > 256 * 1024) {
      throw new Error("DRAFT_TOO_LARGE");
    }
    await (await this.open()).put("drafts", draft);
  }

  async remove(id: string) {
    await (await this.open()).delete("drafts", id);
  }

  async listPending() {
    const records = await (await this.open()).getAllFromIndex("drafts", "by-state", "pending");
    return records.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  }
}
