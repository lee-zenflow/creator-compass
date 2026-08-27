"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import {
  enqueueKnowledgeIngestion,
  reviewKnowledgeItem,
  reviewKnowledgeSource,
  setKnowledgeItemEnabled,
} from "@/server/knowledge/ingestion-service";
import { activatePromptVersion, testKnowledgeRetrieval } from "./admin-service";

async function adminActor() {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  if (actor.kind !== "user" || actor.role !== "admin") redirect("/workspace");
  return actor;
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function csv(form: FormData, key: string) {
  return text(form, key).split(/[，,]/u).map((value) => value.trim()).filter(Boolean);
}

function knowledgeMetadata(form: FormData) {
  return {
    platform: text(form, "platform"),
    contentType: text(form, "contentType"),
    tags: csv(form, "tags"),
  };
}

function uuid(form: FormData, key: string) {
  return z.string().uuid().parse(text(form, key));
}

function reviewStatus(form: FormData) {
  return z.enum(["approved", "rejected"]).parse(text(form, "reviewStatus"));
}

export async function importKnowledgeAction(form: FormData) {
  const actor = await adminActor();
  try {
    const kind = text(form, "kind");
    if (kind === "url") {
      await enqueueKnowledgeIngestion(actor, {
        kind: "url",
        name: text(form, "name"),
        url: text(form, "url"),
        licenseNote: text(form, "licenseNote"),
        ...knowledgeMetadata(form),
      });
    } else if (kind === "text") {
      await enqueueKnowledgeIngestion(actor, {
        kind: "text",
        name: text(form, "name"),
        text: text(form, "content"),
        licenseNote: text(form, "licenseNote"),
        ...knowledgeMetadata(form),
      });
    } else {
      throw new Error("INVALID_KNOWLEDGE_KIND");
    }
    redirect("/admin/knowledge?notice=queued");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/admin/knowledge?notice=invalid");
  }
}

export async function reviewKnowledgeSourceAction(form: FormData) {
  const actor = await adminActor();
  const sourceId = uuid(form, "sourceId");
  try {
    const status = reviewStatus(form);
    const note = text(form, "reviewNote");
    if (note) {
      await reviewKnowledgeSource(actor, sourceId, status, note, text(form, "allowAiSend") === "true");
    } else {
      await reviewKnowledgeSource(actor, sourceId, status, null, text(form, "allowAiSend") === "true");
    }
    redirect(`/admin/knowledge/${sourceId}?notice=source-reviewed`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/admin/knowledge/${sourceId}?notice=source-review-failed`);
  }
}

export async function reviewKnowledgeChunkAction(form: FormData) {
  const actor = await adminActor();
  const sourceId = uuid(form, "sourceId");
  try {
    await reviewKnowledgeItem(
      actor,
      uuid(form, "itemId"),
      reviewStatus(form),
      text(form, "reviewNote") || null,
    );
    redirect(`/admin/knowledge/${sourceId}?notice=chunk-reviewed`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/admin/knowledge/${sourceId}?notice=chunk-review-failed`);
  }
}

export async function setKnowledgeChunkEnabledAction(form: FormData) {
  const actor = await adminActor();
  const sourceId = uuid(form, "sourceId");
  try {
    await setKnowledgeItemEnabled(actor, uuid(form, "itemId"), text(form, "enabled") === "true");
    redirect(`/admin/knowledge/${sourceId}?notice=chunk-updated`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`/admin/knowledge/${sourceId}?notice=chunk-update-failed`);
  }
}

export async function testKnowledgeRetrievalAction(form: FormData) {
  const actor = await adminActor();
  try {
    const result = await testKnowledgeRetrieval(actor, {
      platform: text(form, "platform"),
      contentType: text(form, "contentType"),
      tags: csv(form, "tags"),
      keywords: csv(form, "keywords"),
    });
    return { ok: true as const, ...result };
  } catch {
    return {
      ok: false as const,
      hits: [],
      reasonCounts: {},
      candidateCount: 0,
      acceptedCandidateCount: 0,
      excludedCandidateCount: 0,
      inspectionLimit: 0,
      error: "检索条件无效，或当前服务暂不可用。",
    };
  }
}

export async function activatePromptAction(form: FormData) {
  const actor = await adminActor();
  try {
    await activatePromptVersion(actor, uuid(form, "promptId"));
    redirect("/admin/prompts?notice=activated");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/admin/prompts?notice=failed");
  }
}
