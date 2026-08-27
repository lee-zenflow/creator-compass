import { redirect } from "next/navigation";

import { AuthFrame, LocalSetupForm } from "@/features/identity/auth-ui";
import { getLocalInstanceState } from "@/features/identity/local-owner-service";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const instance = await getLocalInstanceState();
  if (instance.initialized) redirect("/login");
  return (
    <AuthFrame title="初始化本地应用" description="创建这台设备唯一的 Owner。">
      <LocalSetupForm />
    </AuthFrame>
  );
}
