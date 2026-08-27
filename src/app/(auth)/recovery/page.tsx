import { redirect } from "next/navigation";

import { AuthFrame, LocalRecoveryForm } from "@/features/identity/auth-ui";
import { getLocalInstanceState } from "@/features/identity/local-owner-service";

export const dynamic = "force-dynamic";

export default async function RecoveryPage() {
  const instance = await getLocalInstanceState();
  if (!instance.initialized) redirect("/setup");
  return (
    <AuthFrame title="使用恢复码" description="每枚恢复码只能成功使用一次。">
      <LocalRecoveryForm />
    </AuthFrame>
  );
}
