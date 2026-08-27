import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { ModuleIcon } from "@/components/ui/module-icon";
import { resolveCurrentActor, type CurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import {
  createMaterialAction,
  deleteMaterialAction,
  updateMaterialAction,
} from "@/features/materials/material-actions";
import { listMaterialsWithUsage } from "@/features/materials/material-read-service";
import { getMaterial, type MaterialCategory } from "@/features/materials/material-service";

const filters = [
  { id: "all", label: "全部" },
  { id: "inspiration", label: "灵感" },
  { id: "history_content", label: "历史内容" },
] as const;

function formatSavedDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function materialListHref(
  category: MaterialCategory | undefined,
  searchQuery: string | undefined,
  context: { edit?: string } = {},
) {
  const params = new URLSearchParams();
  if (category) params.set("filter", category);
  if (searchQuery) params.set("q", searchQuery);
  if (context.edit) params.set("edit", context.edit);
  const serialized = params.toString();
  return serialized ? `/materials?${serialized}` : "/materials";
}

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; new?: string; edit?: string; error?: string }>;
}) {
  let actor: CurrentActor;
  try {
    actor = await resolveCurrentActor(await headers(), await cookies());
  } catch {
    redirect(HOME_REDIRECT_TARGET);
  }
  const query = await searchParams;
  const category: MaterialCategory | undefined =
    query.filter === "inspiration" || query.filter === "history_content"
      ? query.filter
      : undefined;
  const searchQuery = query.q?.trim().slice(0, 80) || undefined;
  const materialRecords = await listMaterialsWithUsage(actor, { category, query: searchQuery });
  const editing = query.edit ? await getMaterial(actor, query.edit).catch(() => null) : null;
  const editorId = "material-editor-form";

  return (
    <AppShell
      title="素材库"
      backHref="/workspace"
      bottomNav={false}
      rightAction={<span className="compact-count">{materialRecords.length} 项</span>}
      stickyFooter={editing ? (
        <>
          <Link className="compact-button" data-variant="secondary" href={materialListHref(category, searchQuery)}>取消</Link>
          <Button form={editorId} type="submit">保存</Button>
        </>
      ) : undefined}
    >
      <div className="flow-content compact-page">
        <nav className="compact-segmented" aria-label="素材分类筛选">
          {filters.map((filter) => (
            <Link
              className="compact-segmented__item compact-segmented__link"
              data-active={(filter.id === "all" ? !category : category === filter.id) || undefined}
              href={materialListHref(filter.id === "all" ? undefined : filter.id, searchQuery)}
              key={filter.id}
            >
              {filter.label}
            </Link>
          ))}
        </nav>

        <form action="/materials" className="material-search" role="search">
          {category ? <input name="filter" type="hidden" value={category} /> : null}
          <label className="material-search__field">
            <span className="sr-only">搜索素材</span>
            <input
              defaultValue={searchQuery ?? ""}
              maxLength={80}
              name="q"
              placeholder="搜索名称或摘要"
              type="search"
            />
          </label>
          <button type="submit">搜索</button>
        </form>

        {query.error === "material-in-use" ? (
          <p className="compact-message" role="alert">该素材仍被未归档的创作引用，暂不能删除。</p>
        ) : null}

        {!editing ? (
          <details className="compact-disclosure" open={query.new === "1" || undefined}>
            <summary>新建素材</summary>
            <form action={createMaterialAction} className="compact-form compact-card">
              <label>名称<input name="name" required maxLength={120} /></label>
              <div className="compact-form__row">
                <label>分类<select name="category" defaultValue="inspiration"><option value="inspiration">灵感</option><option value="history_content">历史内容</option></select></label>
                <label>类型<input name="type" defaultValue="text" required /></label>
              </div>
              <label>来源<input name="source" defaultValue="manual" required /></label>
              <label>摘要<textarea name="summary" maxLength={500} rows={2} /></label>
              <Button type="submit">保存素材</Button>
            </form>
          </details>
        ) : null}

        <section aria-label="素材列表" className="compact-stack">
          {materialRecords.length === 0 ? (
            searchQuery ? (
              <div className="compact-empty">
                <p>未找到与“{searchQuery}”相关的素材</p>
                <Link className="compact-text-action" href={materialListHref(category, undefined)}>清除搜索</Link>
              </div>
            ) : <div className="compact-empty">还没有素材</div>
          ) : materialRecords.map((material) => {
            const copy = <>
                <strong className="line-clamp-1">{material.name}</strong>
                <span className="material-card__source">来源：{material.source} · 保存于 {formatSavedDate(material.createdAt)}</span>
                <span className="material-card__usage">
                  {material.usage.activeReferenceCount} 次关联 · <span className="material-card__latest">
                    {material.usage.latestCreation ? <>最近更新的创作：{material.usage.latestCreation.title}</> : "尚未用于创作"}
                  </span>
                </span>
              </>;
            return <article className="material-card compact-card" key={material.id}>
              <ModuleIcon name="materials" label={`素材：${material.name}`} />
              {material.usage.latestCreation ? (
                <Link
                  aria-label={`打开最近创作：${material.usage.latestCreation.title}`}
                  className="material-card__copy material-card__copy-link"
                  href={`/creation/${material.usage.latestCreation.projectId}/materials`}
                >
                  {copy}
                </Link>
              ) : <div className="material-card__copy">{copy}</div>}
              <div className="material-card__actions">
                <Link className="compact-text-action" href={materialListHref(category, searchQuery, { edit: material.id })}>编辑</Link>
                <form action={deleteMaterialAction}>
                  <input name="materialId" type="hidden" value={material.id} />
                  <input name="filter" type="hidden" value={category ?? ""} />
                  <input name="q" type="hidden" value={searchQuery ?? ""} />
                  <button className="compact-text-action" type="submit">删除</button>
                </form>
              </div>
            </article>
          })}
        </section>
      </div>

      {editing ? (
        <div className="compact-modal" role="dialog" aria-modal="true" aria-label="编辑素材">
          <form action={updateMaterialAction} className="compact-form compact-card" id={editorId}>
            <div className="compact-form__title">编辑素材</div>
            <input name="materialId" type="hidden" value={editing.id} />
            <input name="filter" type="hidden" value={category ?? ""} />
            <input name="q" type="hidden" value={searchQuery ?? ""} />
            <label>名称<input name="name" defaultValue={editing.name} required maxLength={120} /></label>
            <div className="compact-form__row">
              <label>分类<select name="category" defaultValue={editing.category}><option value="inspiration">灵感</option><option value="history_content">历史内容</option></select></label>
              <label>类型<input name="type" defaultValue={editing.type} required /></label>
            </div>
            <label>来源<input name="source" defaultValue={editing.source} required /></label>
            <label>摘要<textarea name="summary" defaultValue={editing.summary ?? ""} maxLength={500} rows={2} /></label>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
