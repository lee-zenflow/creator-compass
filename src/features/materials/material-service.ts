import { and, count, desc, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import { db, type CreatorCompassDatabase } from "@/server/db/client";
import {
  creationProjects,
  materialReferences,
  materials,
} from "@/server/db/schema";

export const materialCategorySchema = z.enum(["inspiration", "history_content"]);
export const materialIdSchema = z.uuid();

const nullableShortText = z.string().trim().max(500).nullable().optional();

export const materialInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: materialCategorySchema,
  type: z.string().trim().min(1).max(40),
  source: z.string().trim().min(1).max(160),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  summary: nullableShortText,
  body: z.string().trim().max(50_000).nullable().optional(),
  objectKey: z.string().trim().max(500).nullable().optional(),
});

export const materialUpdateSchema = materialInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "MATERIAL_UPDATE_EMPTY",
);

export type MaterialCategory = z.infer<typeof materialCategorySchema>;
export type MaterialInput = z.input<typeof materialInputSchema>;
export type MaterialUpdate = z.input<typeof materialUpdateSchema>;
export type MaterialFilter = { category?: MaterialCategory; query?: string };

export type MaterialRecord = {
  id: string;
  owner: CurrentActor;
  name: string;
  category: MaterialCategory;
  type: string;
  source: string;
  tags: string[];
  summary: string | null;
  body: string | null;
  objectKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MaterialCreateRecord = Omit<MaterialRecord, "id" | "owner" | "createdAt" | "updatedAt">;

export interface MaterialRepository {
  transaction<T>(work: (repository: MaterialRepository) => Promise<T>): Promise<T>;
  lock(actor: CurrentActor, materialId: string): Promise<void>;
  create(actor: CurrentActor, input: MaterialCreateRecord): Promise<MaterialRecord>;
  list(actor: CurrentActor, filter: MaterialFilter): Promise<MaterialRecord[]>;
  get(actor: CurrentActor, materialId: string): Promise<MaterialRecord | null>;
  update(
    actor: CurrentActor,
    materialId: string,
    patch: Partial<MaterialRecord>,
  ): Promise<MaterialRecord | null>;
  countActiveReferences(actor: CurrentActor, materialId: string): Promise<number>;
  deleteReferences(actor: CurrentActor, materialId: string): Promise<void>;
  delete(actor: CurrentActor, materialId: string): Promise<boolean>;
}

function actorWhere(
  actor: CurrentActor,
  table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn },
) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

function ownerValues(actor: CurrentActor) {
  return actor.kind === "user"
    ? { userId: actor.userId, guestSessionId: null }
    : { userId: null, guestSessionId: actor.guestSessionId };
}

function ownerFromRow(row: { userId: string | null; guestSessionId: string | null }): CurrentActor {
  if (row.userId) return { kind: "user", userId: row.userId, role: "user" };
  if (row.guestSessionId) return { kind: "guest", guestSessionId: row.guestSessionId };
  throw new Error("INVALID_OWNER");
}

function toMaterialRecord(row: typeof materials.$inferSelect): MaterialRecord {
  return {
    id: row.id,
    owner: ownerFromRow(row),
    name: row.name,
    category: row.category,
    type: row.type,
    source: row.source,
    tags: row.tags,
    summary: row.summary,
    body: row.body,
    objectKey: row.objectKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function createDatabaseMaterialRepository(
  database: CreatorCompassDatabase,
): MaterialRepository {
  return {
    async transaction(work) {
      return database.transaction(async (transaction) =>
        work(createDatabaseMaterialRepository(transaction as unknown as CreatorCompassDatabase)),
      );
    },
    async lock(actor, materialId) {
      const ownerPredicate =
        actor.kind === "user"
          ? sql`"user_id" = ${actor.userId} and "guest_session_id" is null`
          : sql`"guest_session_id" = ${actor.guestSessionId} and "user_id" is null`;
      await database.execute(
        sql`select "id" from "materials" where "id" = ${materialId} and ${ownerPredicate} for update`,
      );
    },
    async create(actor, input) {
      const [row] = await database
        .insert(materials)
        .values({ ...input, ...ownerValues(actor) })
        .returning();
      if (!row) throw new Error("MATERIAL_CREATE_FAILED");
      return toMaterialRecord(row);
    },
    async list(actor, filter) {
      const conditions = [actorWhere(actor, materials)];
      if (filter.category) conditions.push(eq(materials.category, filter.category));
      const query = filter.query?.trim();
      if (query) {
        conditions.push(
          or(ilike(materials.name, `%${query}%`), ilike(materials.summary, `%${query}%`))!,
        );
      }
      const rows = await database
        .select()
        .from(materials)
        .where(and(...conditions))
        .orderBy(desc(materials.updatedAt), desc(materials.createdAt));
      return rows.map(toMaterialRecord);
    },
    async get(actor, materialId) {
      const [row] = await database
        .select()
        .from(materials)
        .where(and(eq(materials.id, materialId), actorWhere(actor, materials)))
        .limit(1);
      return row ? toMaterialRecord(row) : null;
    },
    async update(actor, materialId, patch) {
      const [row] = await database
        .update(materials)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.category === undefined ? {} : { category: patch.category }),
          ...(patch.type === undefined ? {} : { type: patch.type }),
          ...(patch.source === undefined ? {} : { source: patch.source }),
          ...(patch.tags === undefined ? {} : { tags: patch.tags }),
          ...(patch.summary === undefined ? {} : { summary: patch.summary }),
          ...(patch.body === undefined ? {} : { body: patch.body }),
          ...(patch.objectKey === undefined ? {} : { objectKey: patch.objectKey }),
          updatedAt: new Date(),
        })
        .where(and(eq(materials.id, materialId), actorWhere(actor, materials)))
        .returning();
      return row ? toMaterialRecord(row) : null;
    },
    async countActiveReferences(actor, materialId) {
      const [result] = await database
        .select({ value: count() })
        .from(materialReferences)
        .innerJoin(
          creationProjects,
          eq(materialReferences.creationProjectId, creationProjects.id),
        )
        .where(
          and(
            eq(materialReferences.materialId, materialId),
            actorWhere(actor, materialReferences),
            actorWhere(actor, creationProjects),
            ne(creationProjects.status, "archived"),
          ),
        );
      return result?.value ?? 0;
    },
    async deleteReferences(actor, materialId) {
      await database
        .delete(materialReferences)
        .where(
          and(
            eq(materialReferences.materialId, materialId),
            actorWhere(actor, materialReferences),
          ),
        );
    },
    async delete(actor, materialId) {
      const rows = await database
        .delete(materials)
        .where(and(eq(materials.id, materialId), actorWhere(actor, materials)))
        .returning({ id: materials.id });
      return rows.length === 1;
    },
  };
}

export const databaseMaterialRepository = createDatabaseMaterialRepository(db);

export async function createMaterial(
  actor: CurrentActor,
  input: MaterialInput,
  repository: MaterialRepository = databaseMaterialRepository,
) {
  const parsed = materialInputSchema.parse(input);
  return repository.create(actor, {
    ...parsed,
    summary: parsed.summary ?? null,
    body: parsed.body ?? null,
    objectKey: parsed.objectKey ?? null,
  });
}

export function listMaterials(
  actor: CurrentActor,
  filter: MaterialFilter = {},
  repository: MaterialRepository = databaseMaterialRepository,
) {
  return repository.list(actor, {
    ...filter,
    query: filter.query?.trim() || undefined,
  });
}

export async function getMaterial(
  actor: CurrentActor,
  materialId: string,
  repository: MaterialRepository = databaseMaterialRepository,
) {
  const parsedMaterialId = materialIdSchema.parse(materialId);
  const material = await repository.get(actor, parsedMaterialId);
  if (!material) throw new Error("NOT_FOUND");
  return material;
}

export async function updateMaterial(
  actor: CurrentActor,
  materialId: string,
  patch: MaterialUpdate,
  repository: MaterialRepository = databaseMaterialRepository,
) {
  const parsedMaterialId = materialIdSchema.parse(materialId);
  const parsed = materialUpdateSchema.parse(patch);
  const material = await repository.update(actor, parsedMaterialId, parsed);
  if (!material) throw new Error("NOT_FOUND");
  return material;
}

export function deleteMaterial(
  actor: CurrentActor,
  materialId: string,
  repository: MaterialRepository = databaseMaterialRepository,
) {
  const parsedMaterialId = materialIdSchema.parse(materialId);
  return repository.transaction(async (transaction) => {
    const material = await transaction.get(actor, parsedMaterialId);
    if (!material) throw new Error("NOT_FOUND");
    await transaction.lock(actor, parsedMaterialId);
    if ((await transaction.countActiveReferences(actor, parsedMaterialId)) > 0) {
      throw new Error("MATERIAL_IN_USE");
    }
    await transaction.deleteReferences(actor, parsedMaterialId);
    if (!(await transaction.delete(actor, parsedMaterialId))) throw new Error("NOT_FOUND");
  });
}
