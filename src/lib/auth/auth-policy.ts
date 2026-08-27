export const AUTH_RATE_LIMIT_OPTIONS = {
  window: 60,
  max: 100,
  customRules: {
    "/sign-in/email": { window: 60, max: 10 },
    "/sign-up/email": { window: 60 * 15, max: 5 },
    "/request-password-reset": { window: 60 * 15, max: 5 },
    "/send-verification-email": { window: 60 * 15, max: 5 },
  },
} as const;

export const LOCAL_EMAIL_PASSWORD_OPTIONS = {
  enabled: true,
  disableSignUp: true,
  requireEmailVerification: false,
  minPasswordLength: 10,
  maxPasswordLength: 128,
  revokeSessionsOnPasswordReset: true,
} as const;

export function parseTrustedProxies(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
