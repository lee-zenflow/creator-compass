import { describe, expect, test } from "vitest";

import type { CurrentActor } from "@/features/identity/current-actor";
import type { MaterialRecord } from "./material-service";
import {
  escapeMaterialSearchPattern,
  listMaterialsWithUsage,
  type MaterialUsageReadRepository,
  type MaterialUsageRow,
} from "./material-read-service";

const owner: CurrentActor = {
  kind: "guest",
  guestSessionId: "10000000-0000-4000-8000-000000000001",
};
const other: CurrentActor = {
  kind: "guest",
  guestSessionId: "20000000-0000-4000-8000-000000000002",
};
const materialId = "30000000-0000-4000-8000-000000000003";
const projectId = "40000000-0000-4000-8000-000000000004";

function actorKey(actor: CurrentActor) {
  return actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`;
}

function material(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: materialId,
    owner,
    name: "访谈开场素材",
    category: "inspiration",
    type: "text",
    source: "用户访谈记录",
    tags: ["访谈"],
    summary: "从真实访谈中提炼的开场方式",
    body: null,
    objectKey: null,
    createdAt: new Date("2026-08-18T08:00:00.000Z"),
    updatedAt: new Date("2026-08-18T08:00:00.000Z"),
    ...overrides,
  };
}

class MemoryMaterialUsageRepository implements MaterialUsageReadRepository {
  materialQueries = 0;
  usageQueries = 0;
  lastMaterialLimit: number | undefined;

  constructor(
    private readonly materials: MaterialRecord[],
    private readonly usageRows: Array<MaterialUsageRow & { owner: CurrentActor }>,
  ) {}

  async listMaterials(
    actor: CurrentActor,
    filter: { query?: string; category?: MaterialRecord["category"] },
    limit: number,
  ) {
    this.materialQueries += 1;
    this.lastMaterialLimit = limit;
    return this.materials.filter((row) =>
      actorKey(row.owner) === actorKey(actor)
      && (!filter.category || row.category === filter.category)
      && (!filter.query || `${row.name} ${row.summary ?? ""}`.includes(filter.query))
    );
  }

  async listActiveUsage(actor: CurrentActor, materialIds: string[]) {
    this.usageQueries += 1;
    return this.usageRows
      .filter((row) => actorKey(row.owner) === actorKey(actor) && materialIds.includes(row.materialId))
      .map((row) => ({
        materialId: row.materialId,
        activeReferenceCount: row.activeReferenceCount,
        projectId: row.projectId,
        title: row.title,
        updatedAt: row.updatedAt,
      }));
  }
}

describe("material usage read model", () => {
  test("returns active reference count and the newest owned creation", async () => {
    const repository = new MemoryMaterialUsageRepository(
      [material()],
      [
        {
          owner,
          materialId,
          activeReferenceCount: 2,
          projectId,
          title: "完成第一条访谈内容",
          updatedAt: new Date("2026-08-19T09:00:00.000Z"),
        },
      ],
    );

    const rows = await listMaterialsWithUsage(owner, { query: "访谈" }, repository);

    expect(rows[0]).toMatchObject({
      name: "访谈开场素材",
      usage: {
        activeReferenceCount: 2,
        latestCreation: { projectId, title: "完成第一条访谈内容" },
      },
    });
    expect(rows[0]?.usage.latestCreation?.updatedAt).toEqual(
      new Date("2026-08-19T09:00:00.000Z"),
    );
  });

  test("never includes another actor's references in usage", async () => {
    const repository = new MemoryMaterialUsageRepository(
      [material()],
      [{
        owner: other,
        materialId,
        activeReferenceCount: 1,
        projectId,
        title: "其他账号的创作",
        updatedAt: new Date("2026-08-20T09:00:00.000Z"),
      }],
    );

    const rows = await listMaterialsWithUsage(owner, {}, repository);

    expect(rows[0]?.usage.activeReferenceCount).toBe(0);
    expect(rows[0]?.usage.latestCreation).toBeNull();
  });

  test("trims search to 80 characters and uses only two bounded queries", async () => {
    const repository = new MemoryMaterialUsageRepository([material()], []);

    await listMaterialsWithUsage(owner, { query: "  访谈  " }, repository);

    expect(repository.materialQueries).toBe(1);
    expect(repository.usageQueries).toBe(1);
    expect(repository.lastMaterialLimit).toBe(100);
    await expect(
      listMaterialsWithUsage(owner, { query: "长".repeat(81) }, repository),
    ).rejects.toThrow();
    expect(repository.materialQueries).toBe(1);
    expect(repository.usageQueries).toBe(1);
  });

  test("treats LIKE control characters as literal search text", () => {
    expect(escapeMaterialSearchPattern(String.raw`50%_\完成`)).toBe(String.raw`50\%\_\\完成`);
  });

  test("returns a display whitelist without owner or private material content", async () => {
    const repository = new MemoryMaterialUsageRepository([
      material({ body: "只用于生成的完整私密正文", objectKey: "private/material.txt" }),
    ], []);

    const [row] = await listMaterialsWithUsage(owner, {}, repository);

    expect(row).not.toHaveProperty("owner");
    expect(row).not.toHaveProperty("body");
    expect(row).not.toHaveProperty("objectKey");
  });

  test("does not query usage when the owned material result is empty", async () => {
    const repository = new MemoryMaterialUsageRepository([], []);

    await expect(listMaterialsWithUsage(owner, {}, repository)).resolves.toEqual([]);
    expect(repository.materialQueries).toBe(1);
    expect(repository.usageQueries).toBe(0);
  });
});
