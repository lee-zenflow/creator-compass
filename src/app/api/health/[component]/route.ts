import { NextResponse } from "next/server";

import { checkSystemHealth, productionHealthDependencies } from "@/server/health/health-service";

export const dynamic = "force-dynamic";

const components = ["web", "database", "worker", "storage"] as const;

export async function GET(_request: Request, context: { params: Promise<{ component: string }> }) {
  const { component } = await context.params;
  if (!components.includes(component as (typeof components)[number])) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  if (component === "web") {
    return NextResponse.json({ component, status: "healthy", checkedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
  const health = await checkSystemHealth(productionHealthDependencies());
  const status = health.components[component as "database" | "worker" | "storage"];
  return NextResponse.json({ component, status, checkedAt: health.checkedAt }, {
    status: status === "healthy" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
