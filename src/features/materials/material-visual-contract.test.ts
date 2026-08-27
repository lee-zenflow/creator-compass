import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const styles = readFileSync("src/app/globals.css", "utf8");
const page = readFileSync("src/app/(product)/materials/page.tsx", "utf8");
const service = readFileSync("src/features/materials/material-read-service.ts", "utf8");
const deleteService = readFileSync("src/features/materials/material-service.ts", "utf8");

function numericCssValue(selector: RegExp, property: string) {
  const block = styles.match(selector)?.[0];
  const value = block?.match(new RegExp(`${property}:\\s*(\\d+)px`))?.[1];
  if (!value) throw new Error(`Missing ${property} in ${selector}`);
  return Number(value);
}

describe("material record density", () => {
  test("keeps material rows compact and long summaries clamped", () => {
    expect(styles).toMatch(/\.material-card\s*\{[^}]*height:\s*64px[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.material-picker__item\s*\{[^}]*height:\s*64px[^}]*overflow:\s*hidden/);
    expect(styles).toMatch(/\.material-card__actions \.compact-text-action\s*\{[^}]*min-width:\s*42px[^}]*min-height:\s*42px/);
    expect(page).toContain('<strong className="line-clamp-1">{material.name}</strong>');
    expect(page).toContain('<span className="material-card__source">');
  });

  test("keeps the new-material form collapsed by default", () => {
    expect(page).toContain('<details className="compact-disclosure"');
    expect(page).toContain('open={query.new === "1" || undefined}');
  });

  test("exposes truthful search, source, saved date, usage, and latest creation metadata", () => {
    expect(page).toContain('name="q"');
    expect(page).toContain('defaultValue={searchQuery ?? ""}');
    expect(page).toContain('name="filter"');
    expect(page).toContain("来源：{material.source}");
    expect(page).toContain("保存于 {formatSavedDate(material.createdAt)}");
    expect(page).toContain("{material.usage.activeReferenceCount} 次关联");
    expect(page).toContain("最近更新的创作：{material.usage.latestCreation.title}");
    expect(page).toContain("尚未用于创作");
    expect(page).toContain('href={`/creation/${material.usage.latestCreation.projectId}/materials`}');
    expect(page).toContain('className="material-card__copy material-card__copy-link"');
  });

  test("makes the latest creation a 42px target without growing the 64px row", () => {
    expect(styles).toMatch(/\.material-card__copy-link\s*\{[^}]*min-height:\s*42px/);
    expect(styles).toMatch(/\.material-card\s*\{[^}]*height:\s*64px/);
  });

  test("clamps long source and creation titles without expanding mobile rows", () => {
    expect(styles).toMatch(/\.material-card__source,[\s\S]*?\.material-card__usage\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
    expect(styles).toMatch(/\.material-card__latest\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
    expect(styles).toMatch(/\.material-card\s*\{[^}]*height:\s*64px/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*412px\)[\s\S]*?\.material-card\s*\{[^}]*height:\s*64px/);
    expect(styles).toMatch(/\.material-card\s*>\s*\.material-card__actions\s*\{[^}]*display:\s*flex[^}]*flex:\s*none/);

    const rowHeight = numericCssValue(/\.material-card\s*\{[^}]*\}/, "height");
    const verticalPadding = numericCssValue(/\.material-card\s*\{[^}]*\}/, "padding-block");
    const copyGap = numericCssValue(/\.material-card\s*>\s*\.material-card__copy\s*\{[^}]*\}/, "gap");
    const titleLine = numericCssValue(/\.material-card__copy\s*>\s*strong\s*\{[^}]*\}/, "line-height");
    const metaLine = numericCssValue(/\.material-card__source,[\s\S]*?\.material-card__usage\s*\{[^}]*\}/, "line-height");
    expect(verticalPadding * 2 + titleLine + metaLine * 2 + copyGap * 2).toBeLessThanOrEqual(rowHeight);
  });

  test("keeps filtering, empty search recovery, and delete failures in the same list context", () => {
    expect(page).toContain('value={searchQuery ?? ""}');
    expect(page).toContain('value={category ?? ""}');
    expect(page).toContain('未找到与“{searchQuery}”相关的素材');
    expect(page).toContain('className="compact-text-action" href={materialListHref(category, undefined)}');
    expect(page).toContain('href={materialListHref(category, searchQuery, { edit: material.id })}');
    expect(page).toContain('data-variant="secondary" href={materialListHref(category, searchQuery)}');
    expect(page).toContain("该素材仍被未归档的创作引用，暂不能删除。");
  });

  test("bounds the read and scopes materials, references, and projects to the current actor", () => {
    expect(service).toContain("const MATERIAL_LIST_LIMIT = 100");
    expect(service).toContain("actorWhere(actor, materials)");
    expect(service).toContain("actorWhere(actor, materialReferences)");
    expect(service).toContain("actorWhere(actor, creationProjects)");
    expect(deleteService).toContain("actorWhere(actor, creationProjects)");
    expect(service).toContain('ne(creationProjects.status, "archived")');
    expect(deleteService).toContain('ne(creationProjects.status, "archived")');
    expect(service).toContain("selectDistinctOn([materialReferences.materialId]");
    expect(service).toMatch(/count\(\*\) over \(partition by/);
    expect(service).toContain(".limit(Math.min(materialIds.length, MATERIAL_LIST_LIMIT))");
  });
});
