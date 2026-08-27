import { randomUUID } from "node:crypto";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { AiSendDisclosure } from "@/components/ui/ai-send-disclosure";
import { buildFallbackSendDisclosure, buildSendDisclosure } from "@/features/ai/send-disclosure";
import { attachAndGenerateContentPlanAction } from "@/features/creation/creation-actions";
import { getCreationProject } from "@/features/creation/creation-read-service";
import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { listMaterials } from "@/features/materials/material-service";

export default async function CreationMaterialsPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  let actor;
  try { actor = await resolveCurrentActor(await headers(), await cookies()); } catch { redirect(HOME_REDIRECT_TARGET); }
  const { projectId } = await params;
  const project = await getCreationProject(actor, projectId).catch(() => null);
  if (!project) notFound();
  const materialRecords = await listMaterials(actor, {});
  const query = await searchParams;
  const loadedDisclosure = await buildSendDisclosure(actor, "content_plan", projectId)
    .catch(() => buildFallbackSendDisclosure("content_plan"));
  const disclosure = {
    ...loadedDisclosure,
    materials: ["本页提交时勾选的本地素材（仅所选项）"],
  };
  return (
    <AppShell title="选择参考素材" backHref="/creation/new" bottomNav={false} stickyFooter={<button className="compact-button" form="creation-materials" type="submit">生成内容方案</button>}>
      <form action={attachAndGenerateContentPlanAction} className="flow-content compact-page" id="creation-materials">
        <input name="projectId" type="hidden" value={project.id} />
        <input name="idempotencyKey" type="hidden" value={`content:${randomUUID()}`} />
        <p className="compact-message">素材是参考依据，不会覆盖你的创作目标；可以不选。</p>
        <AiSendDisclosure disclosure={disclosure} title="生成内容方案时将发送" />
        <section className="compact-stack" aria-label="素材列表">
          {materialRecords.length ? materialRecords.map((material) => (
            <label className="creation-material-row compact-card" key={material.id}>
              <input defaultChecked={project.selectedMaterialIds.includes(material.id)} name="materialIds" type="checkbox" value={material.id} />
              <span><strong>{material.name}</strong><small>{material.category === "inspiration" ? "灵感" : "历史内容"} · {material.type}</small></span>
            </label>
          )) : <div className="compact-empty">还没有素材，可先直接生成或去素材库新建</div>}
        </section>
        <Link className="compact-button" data-variant="secondary" href="/materials?new=1">新建素材</Link>
        {query.notice ? <p className="compact-message" data-error="true">{query.notice === "not-configured" ? "AI 尚未配置，需求和素材选择已保存，但不会伪造生成结果。" : "生成未开始，已保留需求和素材选择，请重试。"}</p> : null}
      </form>
    </AppShell>
  );
}
