import { NextResponse } from "next/server";

import { checkSystemHealth, productionHealthDependencies } from "@/server/health/health-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await checkSystemHealth(productionHealthDependencies());
  return NextResponse.json(health, {
    status: health.status === "healthy" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
