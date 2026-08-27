"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { createMaterial, deleteMaterial, updateMaterial } from "./material-service";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function materialListTarget(formData: FormData, error?: "material-in-use") {
  const params = new URLSearchParams();
  const filter = text(formData, "filter");
  const query = text(formData, "q").slice(0, 80);
  if (filter === "inspiration" || filter === "history_content") params.set("filter", filter);
  if (query) params.set("q", query);
  if (error) params.set("error", error);
  const serialized = params.toString();
  return serialized ? `/materials?${serialized}` : "/materials";
}

export async function createMaterialAction(formData: FormData) {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  await createMaterial(actor, {
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "inspiration") as "inspiration" | "history_content",
    type: String(formData.get("type") ?? "text"),
    source: String(formData.get("source") ?? "manual"),
    summary: String(formData.get("summary") ?? "") || null,
    tags: [],
    body: null,
    objectKey: null,
  });
  revalidatePath("/materials");
  redirect(materialListTarget(formData));
}

export async function deleteMaterialAction(formData: FormData) {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  try {
    await deleteMaterial(actor, String(formData.get("materialId") ?? ""));
  } catch (error) {
    if (error instanceof Error && error.message === "MATERIAL_IN_USE") {
      return redirect(materialListTarget(formData, "material-in-use"));
    }
    throw error;
  }
  revalidatePath("/materials");
}

export async function updateMaterialAction(formData: FormData) {
  const actor = await resolveCurrentActor(await headers(), await cookies());
  const materialId = String(formData.get("materialId") ?? "");
  await updateMaterial(actor, materialId, {
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? "inspiration") as "inspiration" | "history_content",
    type: String(formData.get("type") ?? "text"),
    source: String(formData.get("source") ?? "manual"),
    summary: String(formData.get("summary") ?? "") || null,
  });
  revalidatePath("/materials");
  redirect(materialListTarget(formData));
}
