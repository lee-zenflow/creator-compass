import { cookies } from "next/headers";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { assertTrustedMutationOrigin } from "@/lib/auth/security";
import { createLocalPortableBackup } from "@/server/maintenance/local-backup-controller";
import { enforceRateLimit } from "@/server/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request.headers.get("origin"), process.env.APP_URL ?? "http://localhost:3000");
    const actor = await resolveCurrentActor(request.headers, await cookies());
    if (actor.kind !== "user") throw new Error("UNAUTHORIZED");
    enforceRateLimit("backup", `user:${actor.userId}`);
    const form = await request.formData();
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== confirmation) throw new Error("BACKUP_PASSWORD_MISMATCH");
    const encrypted = await createLocalPortableBackup(password);
    return new Response(Buffer.from(encrypted), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="creator-compass-${new Date().toISOString().slice(0, 10)}.ccbackup"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "BACKUP_CREATE_FAILED";
    if (code === "UNAUTHORIZED") return Response.json({ error: code }, { status: 401 });
    if (code === "RATE_LIMITED") return Response.json({ error: code }, { status: 429 });
    if (["BACKUP_PASSWORD_TOO_SHORT", "BACKUP_PASSWORD_MISMATCH"].includes(code)) {
      return Response.json({ error: code }, { status: 400 });
    }
    return Response.json({ error: "BACKUP_CREATE_FAILED" }, { status: 500 });
  }
}
