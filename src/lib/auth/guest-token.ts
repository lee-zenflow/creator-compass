import { createHash, randomBytes } from "node:crypto";

export const GUEST_COOKIE_NAME = "creator_compass_guest";
export const GUEST_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type GuestCookie = {
  name: typeof GUEST_COOKIE_NAME;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
};

export function createGuestToken() {
  return randomBytes(32).toString("base64url");
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readCookieToken(cookieHeader: string | null, name = GUEST_COOKIE_NAME) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const cookieName = part.slice(0, separator).trim();
    if (cookieName !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function createGuestCookie(token: string, production = process.env.NODE_ENV === "production") {
  return {
    name: GUEST_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: production,
    maxAge: GUEST_SESSION_TTL_SECONDS,
  } satisfies GuestCookie;
}

export function clearGuestCookie(production = process.env.NODE_ENV === "production") {
  return { ...createGuestCookie("", production), maxAge: 0 };
}
