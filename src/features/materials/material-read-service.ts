import { and, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { CurrentActor } from "@/features/identity/current-actor";
import {
  materialCategorySchema,
  type MaterialCategory,
} from "@/features/materials/material-service";
import { db } from "@/server/db/client";
import { creationProjects, materialReferences, materials } from "@/server/db/schema";

const MATERIAL_LIST_LIMIT = 100;

export const materialUsageFilterSchema = z.object({
  category: materialCategorySchema.optional(),
  query: z.string().trim().max(80).optional(),
}).strict();

export type MaterialUsageFilter = {
  category?: MaterialCategory;
  query?: string;
};

export type MaterialUsageRow = {
  materialId: string;
  activeReferenceCount: number;
  projectId: string;
  title: string;
  updatedAt: Date;
};

export type MaterialUsageBaseRow = {
  id: string;
  name: string;
  category: MaterialCategory;
  type: string;
  source: string;
  tags: string[];
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MaterialWithUsage = MaterialUsageBaseRow & {
  usage: {
    activeReferenceCount: number;
    latestCreation: null | {
      projectId: string;
      title: string;
      updatedAt: Date;
    };
  };
};

export interface MaterialUsageReadRepository {
  listMaterials(
    actor: CurrentActor,
    filter: MaterialUsageFilter,
    limit: number,
  ): Promise<MaterialUsageBaseRow[]>;
  listActiveUsage(actor: CurrentActor, materialIds: string[]): Promise<MaterialUsageRow[]>;
}

function actorWhere(
  actor: CurrentActor,
  table: { userId: AnyPgColumn; guestSessionId: AnyPgColumn },
) {
  return actor.kind === "user"
    ? and(eq(table.userId, actor.userId), isNull(table.guestSessionId))
    : and(eq(table.guestSessionId, actor.guestSessionId), isNull(table.userId));
}

export function escapeMaterialSearchPattern(query: string) {
  return query.replace(/[\\%_]/g, "\\$&");
}

const databaseMaterialUsageReadRepository: MaterialUsageReadRepository = {
  async listMaterials(actor, filter, limit) {
    const conditions = [actorWhere(actor, materials)];
    if (filter.category) conditions.push(eq(materials.category, filter.category));
    if (filter.query) {
      const pattern = `%${escapeMaterialSearchPattern(filter.query)}%`;
      conditions.push(
        or(ilike(materials.name, pattern), ilike(materials.summary, pattern))!,
      );
    }

    return db
      .select({
        id: materials.id,
        name: materials.name,
        category: materials.category,
        type: materials.type,
        source: materials.source,
        tags: materials.tags,
        summary: materials.summary,
        createdAt: materials.createdAt,
        updatedAt: materials.updatedAt,
      })
      .from(materials)
      .where(and(...conditions))
      .orderBy(desc(materials.updatedAt), desc(materials.createdAt), desc(materials.id))
      .limit(limit);
  },
  async listActiveUsage(actor, materialIds) {
    if (materialIds.length === 0) return [];

    return db
      .selectDistinctOn([materialReferences.materialId], {
        materialId: materialReferences.materialId,
        activeReferenceCount: sql<number>`count(*) over (partition by ${materialReferences.materialId})`.mapWith(Number),
        projectId: creationProjects.id,
        title: creationProjects.goal,
        updatedAt: creationProjects.updatedAt,
      })
      .from(materialReferences)
      .innerJoin(
        materials,
        and(
          eq(materialReferences.materialId, materials.id),
          actorWhere(actor, materials),
        ),
      )
      .innerJoin(
        creationProjects,
        and(
          eq(materialReferences.creationProjectId, creationProjects.id),
          actorWhere(actor, creationProjects),
        ),
      )
      .where(
        and(
          inArray(materialReferences.materialId, materialIds),
          actorWhere(actor, materialReferences),
          ne(creationProjects.status, "archived"),
        ),
      )
      .orderBy(
        materialReferences.materialId,
        desc(creationProjects.updatedAt),
        desc(creationProjects.id),
      )
      .limit(Math.min(materialIds.length, MATERIAL_LIST_LIMIT));
  },
};

export async function listMaterialsWithUsage(
  actor: CurrentActor,
  filter: MaterialUsageFilter = {},
  repository: MaterialUsageReadRepository = databaseMaterialUsageReadRepository,
): Promise<MaterialWithUsage[]> {
  const parsed = materialUsageFilterSchema.parse(filter);
  const normalizedFilter: MaterialUsageFilter = {
    ...(parsed.category ? { category: parsed.category } : {}),
    ...(parsed.query ? { query: parsed.query } : {}),
  };
  const materialRecords = await repository.listMaterials(
    actor,
    normalizedFilter,
    MATERIAL_LIST_LIMIT,
  );
  if (materialRecords.length === 0) return [];

  const usageByMaterial = new Map<string, MaterialWithUsage["usage"]>();
  for (const row of await repository.listActiveUsage(
    actor,
    materialRecords.map((material) => material.id),
  )) {
    if (!usageByMaterial.has(row.materialId)) {
      usageByMaterial.set(row.materialId, {
        activeReferenceCount: row.activeReferenceCount,
        latestCreation: {
        projectId: row.projectId,
        title: row.title,
        updatedAt: row.updatedAt,
        },
      });
    }
  }

  return materialRecords.map((material) => {
    const { id, name, category, type, source, tags, summary, createdAt, updatedAt } = material;
    return {
      id,
      name,
      category,
      type,
      source,
      tags,
      summary,
      createdAt,
      updatedAt,
      usage: usageByMaterial.get(id) ?? {
        activeReferenceCount: 0,
        latestCreation: null,
      },
    };
  });
}
