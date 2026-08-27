"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { factoryReset } from "@/server/maintenance/factory-reset";
import { resolveCurrentActor, type CurrentActor } from "./current-actor";
import { HOME_REDIRECT_TARGET } from "./navigation";

type ResetInput = {
  password: string;
  confirmation: string;
  backupAcknowledged: boolean;
  secondConfirmation: boolean;
};
type ResetProduct = (actor: CurrentActor, input: ResetInput) => Promise<void>;

export async function factoryResetIntent(
  actor: CurrentActor,
  input: ResetInput,
  reset: ResetProduct = factoryReset,
) {
  if (actor.kind !== "user") throw new Error("FORBIDDEN");
  await reset(actor, input);
}

export async function factoryResetAction(formData: FormData) {
  let actor: CurrentActor;
  try {
    actor = await resolveCurrentActor(await headers(), await cookies());
  } catch {
    redirect(HOME_REDIRECT_TARGET);
  }
  try {
    await factoryResetIntent(actor, {
      password: String(formData.get("password") ?? ""),
      confirmation: String(formData.get("confirmation") ?? ""),
      backupAcknowledged: formData.get("backupAcknowledged") === "on",
      secondConfirmation: formData.get("secondConfirmation") === "on",
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const notice = error instanceof Error && error.message === "FACTORY_RESET_PASSWORD_INVALID"
      ? "bad-password"
      : error instanceof Error && error.message === "FACTORY_RESET_CONFIRMATION_REQUIRED"
        ? "invalid"
        : "reset-failed";
    redirect(`/me/settings?notice=${notice}`);
  }
  redirect("/setup?reset=1");
}
