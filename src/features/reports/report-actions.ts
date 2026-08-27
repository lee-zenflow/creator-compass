"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveCurrentActor, type CurrentActor } from "@/features/identity/current-actor";
import { HOME_REDIRECT_TARGET } from "@/features/identity/navigation";
import { reportNoticeHref } from "./report-navigation";
import { archiveReport, restoreReport } from "./report-service";

const reportTypeFilter = z.enum(["all", "positioning", "creation", "review"]);
const reportView = z.enum(["active", "archived"]);
const reportContext = z.object({
  type: reportTypeFilter,
  view: reportView,
}).strict();
const reportActionInput = reportContext.extend({ reportId: z.uuid() }).strict();

async function currentActor() {
  try {
    return await resolveCurrentActor(await headers(), await cookies());
  } catch {
    redirect(HOME_REDIRECT_TARGET);
  }
}

export async function archiveReportIntent(
  actor: CurrentActor,
  input: unknown,
  dependencies: { archive: typeof archiveReport } = { archive: archiveReport },
) {
  const parsed = reportActionInput.parse(input);
  await dependencies.archive(actor, parsed.reportId);
  return { ok: true as const, type: parsed.type, view: parsed.view };
}

export async function restoreReportIntent(
  actor: CurrentActor,
  input: unknown,
  dependencies: { restore: typeof restoreReport } = { restore: restoreReport },
) {
  const parsed = reportActionInput.parse(input);
  await dependencies.restore(actor, parsed.reportId);
  return { ok: true as const, type: parsed.type, view: parsed.view };
}

function formInput(formData: FormData) {
  return {
    reportId: String(formData.get("reportId") ?? "").trim(),
    type: String(formData.get("type") ?? "all").trim(),
    view: String(formData.get("view") ?? "active").trim(),
  };
}

function safeContext(input: ReturnType<typeof formInput>) {
  const parsed = reportContext.safeParse({ type: input.type, view: input.view });
  return parsed.success ? parsed.data : { type: "all" as const, view: "active" as const };
}

export async function archiveReportAction(formData: FormData) {
  const actor = await currentActor();
  const input = formInput(formData);
  const context = safeContext(input);
  try {
    const result = await archiveReportIntent(actor, input);
    revalidatePath("/reports");
    redirect(reportNoticeHref("active", result.type, "archived"));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(reportNoticeHref(context.view, context.type, "failed"));
  }
}

export async function restoreReportAction(formData: FormData) {
  const actor = await currentActor();
  const input = formInput(formData);
  const context = safeContext(input);
  try {
    const result = await restoreReportIntent(actor, input);
    revalidatePath("/reports");
    redirect(reportNoticeHref("active", result.type, "restored"));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(reportNoticeHref(context.view, context.type, "failed"));
  }
}
