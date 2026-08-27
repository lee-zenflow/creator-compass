import { redirect } from "next/navigation";

import { AuthFrame, LoginForm } from "@/features/identity/auth-ui";
import { getLocalInstanceState } from "@/features/identity/local-owner-service";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const instance = await getLocalInstanceState();
  if (!instance.initialized) redirect("/setup");
  return (
    <AuthFrame title="登录" description="数据和凭据只保存在这台设备。">
      <LoginForm ownerName={instance.ownerName} />
    </AuthFrame>
  );
}
