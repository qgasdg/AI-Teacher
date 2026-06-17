/**
 * 백엔드 호출 래퍼. 모든 요청은 /api/proxy/* 를 통해 서버 사이드에서 처리되므로
 * 클라이언트 번들에 시크릿이 포함되지 않음.
 */

export const PROXY = "/api/proxy";

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${PROXY}${path}`;
  return fetch(url, init);
}
