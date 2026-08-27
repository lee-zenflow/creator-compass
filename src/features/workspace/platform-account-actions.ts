"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { createPlatformAccountLabel, setActivePlatformAccount } from "./platform-account-service";

async function actor() {
  try { return await resolveCurrentActor(await headers(), await cookies()); }
  catch { redirect(HOME_REDIRECT_TARGET); }
}
function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function target(form: FormData) {
  const value = text(form, "next");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/me/platforms";
}

export async function createPlatformAccountAction(form: FormData) {
  const current = await actor();
  try {
    await createPlatformAccountLabel(current, {
      platform: z.enum(["douyin", "xiaohongshu", "bilibili", "wechat", "other"]).parse(text(form, "platform")),
      accountLabel: text(form, "accountLabel"),
      dataSource: z.enum(["manual", "ocr"]).parse(text(form, "dataSource")),
    });
    redirect(target(form));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/me/platforms?notice=invalid");
  }
}

export async function setActivePlatformAccountAction(form: FormData) {
  const current = await actor();
  try {
    await setActivePlatformAccount(current, text(form, "accountId"));
    redirect(target(form));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/me/platforms?notice=failed");
  }
}
