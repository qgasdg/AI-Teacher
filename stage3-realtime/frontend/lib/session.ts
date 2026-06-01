import crypto from "crypto";

/**
 * 서버 전용 세션 토큰. HttpOnly 쿠키에 담겨 프록시 인가에 사용됨.
 * 클라이언트는 값을 알 수 없고(서버 시크릿으로 HMAC), 위조도 불가.
 */

const SECRET = process.env.SESSION_SECRET || process.env.API_SECRET || "";

export type Role = "access" | "teacher";

export const COOKIE_NAME: Record<Role, string> = {
  access: "access_session",
  teacher: "teacher_session",
};

export function signToken(role: Role): string {
  return crypto.createHmac("sha256", SECRET).update(role).digest("hex");
}

export function verifyToken(role: Role, token: string | undefined): boolean {
  if (!token || !SECRET) return false;
  const expected = signToken(role);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
