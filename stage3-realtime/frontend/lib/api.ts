/**
 * 백엔드 호출 시 자동으로 Authorization 헤더를 첨부하는 fetch 래퍼.
 *
 * NEXT_PUBLIC_API_SECRET은 번들에 노출되므로 진짜 비밀이 아니라
 * '봇/스캐너 차단용 게이트' 수준임을 인지하고 사용.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";
const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || "";

/** Authorization 헤더가 필요할 때 사용. 시크릿이 비었으면 빈 객체 반환. */
export function authHeaders(): Record<string, string> {
  return API_SECRET ? { Authorization: `Bearer ${API_SECRET}` } : {};
}

/**
 * fetch + 자동 Authorization 헤더 + API_URL prefix.
 * path가 절대 URL이면 그대로 사용.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const merged: Record<string, string> = {
    ...authHeaders(),
    ...((init.headers as Record<string, string>) || {}),
  };
  return fetch(url, { ...init, headers: merged });
}
