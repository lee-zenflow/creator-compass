import { cookies } from "next/headers";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { assertTrustedMutationOrigin } from "@/lib/auth/security";
import { restoreLocalPortableBackup } from "@/server/maintenance/local-backup-controller";
import { enforceRateLimit } from "@/server/security/rate-limit";

export const runtime = "nodejs";
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

function isBackupFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== "string" && typeof value.arrayBuffer === "function");
}

function resultUrl(request: Request, notice: string) {
  return new URL(`/me/backups?notice=${notice}`, request.url);
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request.headers.get("origin"), process.env.APP_URL ?? "http://localhost:3000");
    const actor = await resolveCurrentActor(request.headers, await cookies());
    if (actor.kind !== "user") throw new Error("UNAUTHORIZED");
    enforceRateLimit("backup", `restore:${actor.userId}`);
    const form = await request.formData();
    const password = String(form.get("password") ?? "");
    const file = form.get("backup");
    if (!isBackupFile(file) || file.size < 1 || file.size > MAX_BACKUP_BYTES || !file.name.endsWith(".ccbackup")) {
      throw new Error("BACKUP_FILE_INVALID");
    }
    await restoreLocalPortableBackup(new Uint8Array(await file.arrayBuffer()), password);
    return Response.redirect(resultUrl(request, "restored"), 303);
  } catch (error) {
    const code = error instanceof Error ? error.message : "BACKUP_RESTORE_FAILED";
    if (code === "UNAUTHORIZED") return Response.redirect(new URL("/login", request.url), 303);
    if (code === "RATE_LIMITED") return Response.redirect(resultUrl(request, "limited"), 303);
    return Response.redirect(resultUrl(request, "restore-failed"), 303);
  }
}
