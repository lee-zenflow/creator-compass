import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { resolveCurrentActor } from "@/features/identity/current-actor";
import { getAiRun } from "@/server/ai/run-ai-task";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ aiRunId: string }> },
) {
  try {
    const actor = await resolveCurrentActor(request.headers, await cookies());
    const { aiRunId } = await params;
    const run = await getAiRun(actor, aiRunId);
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (message === "NOT_FOUND") {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    if (error && typeof error === "object" && "name" in error && error.name === "ZodError") {
      return NextResponse.json({ ok: false, error: "INVALID_AI_RUN_ID" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "AI_RUN_STATUS_FAILED" }, { status: 500 });
  }
}
