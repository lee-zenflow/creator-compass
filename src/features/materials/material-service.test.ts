import { describe, expect, test } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  createMaterial,
  deleteMaterial,
  getMaterial,
  listMaterials,
  updateMaterial,
  type MaterialRecord,
  type MaterialRepository,
} from "./material-service";

const owner: CurrentActor = { kind: "guest", guestSessionId: "10000000-0000-4000-8000-000000000001" };
const other: CurrentActor = { kind: "guest", guestSessionId: "20000000-0000-4000-8000-000000000002" };

function actorKey(actor: CurrentActor) {
  return actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
}

class MemoryMaterialRepository implements MaterialRepository {
  records: MaterialRecord[] = [];
  activeReferenceIds = new Set<string>();
  private sequence = 0;

  async transaction<T>(work: (repository: MaterialRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async lock() {}

  async create(actor: CurrentActor, input: Omit<MaterialRecord, "id" | "owner" | "createdAt" | "updatedAt">) {
    const record: MaterialRecord = {
      ...input,
      id: `90000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`,
      owner: actor,
      createdAt: new Date("2026-08-08T12:00:00Z"),
      updatedAt: new Date("2026-08-08T12:00:00Z"),
    };
    this.records.push(record);
    return record;
  }

  async list(actor: CurrentActor, filter: { category?: MaterialRecord["category"]; query?: string }) {
    return this.records.filter(
      (record) =>
        actorKey(record.owner) === actorKey(actor) &&
        (!filter.category || record.category === filter.category) &&
        (!filter.query || `${record.name} ${record.summary ?? ""}`.includes(filter.query)),
    );
  }

  async get(actor: CurrentActor, materialId: string) {
    return this.records.find(
      (record) => record.id === materialId && actorKey(record.owner) === actorKey(actor),
    ) ?? null;
  }

  async update(actor: CurrentActor, materialId: string, patch: Partial<MaterialRecord>) {
    const record = await this.get(actor, materialId);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: new Date("2026-08-08T12:01:00Z") });
    return record;
  }

  async countActiveReferences(actor: CurrentActor, materialId: string) {
    return (await this.get(actor, materialId)) && this.activeReferenceIds.has(materialId) ? 1 : 0;
  }

  async deleteReferences() {}

  async delete(actor: CurrentActor, materialId: string) {
    const index = this.records.findIndex(
      (record) => record.id === materialId && actorKey(record.owner) === actorKey(actor),
    );
    if (index < 0) return false;
    this.records.splice(index, 1);
    return true;
  }
}

const input = {
  name: "高互动开头案例",
  category: "inspiration" as const,
  type: "text",
  source: "manual",
  tags: ["开头", "案例"],
  summary: "三个可复用的开头结构",
  body: "先给结果，再说明过程。",
  objectKey: null,
};

describe("owned material CRUD", () => {
  test("creates, filters, reads, updates, and deletes an owned material", async () => {
    const repository = new MemoryMaterialRepository();
    const material = await createMaterial(owner, input, repository);

    expect(await listMaterials(owner, { category: "inspiration", query: "开头" }, repository)).toHaveLength(1);
    expect((await getMaterial(owner, material.id, repository)).name).toBe(input.name);
    expect((await updateMaterial(owner, material.id, { name: "开头案例库" }, repository)).name).toBe("开头案例库");
    await deleteMaterial(owner, material.id, repository);
    expect(await listMaterials(owner, {}, repository)).toHaveLength(0);
  });

  test("returns MATERIAL_IN_USE and keeps the row when an active plan references it", async () => {
    const repository = new MemoryMaterialRepository();
    const material = await createMaterial(owner, input, repository);
    repository.activeReferenceIds.add(material.id);

    await expect(deleteMaterial(owner, material.id, repository)).rejects.toThrow("MATERIAL_IN_USE");
    expect(await getMaterial(owner, material.id, repository)).toBeDefined();
  });

  test("normalizes another actor's material to NOT_FOUND", async () => {
    const repository = new MemoryMaterialRepository();
    const material = await createMaterial(owner, input, repository);

    await expect(getMaterial(other, material.id, repository)).rejects.toThrow("NOT_FOUND");
    await expect(updateMaterial(other, material.id, { name: "越权" }, repository)).rejects.toThrow("NOT_FOUND");
    await expect(deleteMaterial(other, material.id, repository)).rejects.toThrow("NOT_FOUND");
  });

  test("rejects malformed material IDs before repository access", async () => {
    const repository = new MemoryMaterialRepository();
    await expect(getMaterial(owner, "not-a-uuid", repository)).rejects.toThrow();
    expect(repository.records).toHaveLength(0);
  });
});
