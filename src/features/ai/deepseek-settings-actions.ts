"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { revokeDeepSeekKey, testAndSaveDeepSeekKey } from "./deepseek-settings-service";

async function currentOwner() {
  const actor = await resolveCurrentActor(await headers(), await cookies()).catch(() => null);
  if (!actor || actor.kind !== "user") redirect(HOME_REDIRECT_TARGET);
  return actor;
}

export async function saveDeepSeekKeyAction(formData: FormData) {
  const actor = await currentOwner();
  try {
    await testAndSaveDeepSeekKey(
      actor.userId,
      String(formData.get("apiKey") ?? ""),
      formData.get("consent") === "yes",
    );
  } catch {
    redirect("/me/deepseek?notice=test-failed");
  }
  redirect("/me/deepseek?notice=saved");
}

export async function revokeDeepSeekKeyAction() {
  const actor = await currentOwner();
  await revokeDeepSeekKey(actor.userId);
  redirect("/me/deepseek?notice=revoked");
}
