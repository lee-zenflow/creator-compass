export const GENERIC_ACCOUNT_MESSAGE = "如果该邮箱可用，我们已发送后续邮件，请检查收件箱。";

export function genericAccountResponse() {
  return { ok: true, message: GENERIC_ACCOUNT_MESSAGE } as const;
}

export function assertTrustedMutationOrigin(origin: string | null, applicationUrl: string) {
  let trustedOrigin: string;
  try {
    trustedOrigin = new URL(applicationUrl).origin;
  } catch {
    throw new Error("SERVER_ORIGIN_NOT_CONFIGURED");
  }

  if (!origin) throw new Error("INVALID_ORIGIN");

  try {
    if (new URL(origin).origin !== trustedOrigin) throw new Error("INVALID_ORIGIN");
  } catch {
    throw new Error("INVALID_ORIGIN");
  }
}
