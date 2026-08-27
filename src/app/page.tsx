import { redirect } from "next/navigation";

import { getLocalInstanceState } from "@/features/identity/local-owner-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const instance = await getLocalInstanceState();
  redirect(instance.initialized ? "/login" : "/setup");
}
