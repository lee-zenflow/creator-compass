import { cookies } from "next/headers";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { exportUserData } from "@/features/identity/export-user-data";
import { enforceRateLimit } from "@/server/security/rate-limit";

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentActor(request.headers, await cookies());
    enforceRateLimit("export", actor.kind === "user" ? `user:${actor.userId}` : `guest:${actor.guestSessionId}`);
    const stream = await exportUserData(actor);
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="creator-compass-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
}
