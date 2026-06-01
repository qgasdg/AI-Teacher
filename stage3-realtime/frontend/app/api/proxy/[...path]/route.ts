import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME, type Role } from "@/lib/session";

const BACKEND_URL = process.env.API_URL ?? "http://localhost:8001";
const API_SECRET = process.env.API_SECRET ?? "";

/**
 * 요청에 필요한 최소 권한을 판별.
 * - teacher: 전체 목록 조회(GET /sessions/, /recordings/), 삭제, retry, 오디오
 * - access:  그 외 (세션 생성/조회, 녹음 업로드, 토큰 발급, end/abandon)
 */
function requiredRole(method: string, seg: string[]): Role {
  const last = seg[seg.length - 1];
  const isList = seg.length === 1 && (seg[0] === "sessions" || seg[0] === "recordings");
  if (method === "DELETE") return "teacher";
  if (method === "GET" && isList) return "teacher";
  if (last === "audio" || last === "retry") return "teacher";
  return "access";
}

function authorize(req: NextRequest, role: Role): boolean {
  const teacherOk = verifyToken("teacher", req.cookies.get(COOKIE_NAME.teacher)?.value);
  if (role === "teacher") return teacherOk;
  // teacher는 access의 상위 권한
  const accessOk = verifyToken("access", req.cookies.get(COOKIE_NAME.access)?.value);
  return accessOk || teacherOk;
}

async function proxy(req: NextRequest, pathParts: string[], method: string): Promise<NextResponse> {
  const seg = pathParts.filter(Boolean);

  if (!authorize(req, requiredRole(method, seg))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const path = seg.join("/");
  const qs = req.nextUrl.searchParams.toString();
  const url = `${BACKEND_URL}/${path}${qs ? `?${qs}` : ""}`;

  const headers: Record<string, string> = {};
  if (API_SECRET) headers["Authorization"] = `Bearer ${API_SECRET}`;

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.startsWith("multipart/form-data")) {
      body = await req.formData();
      // Content-Type은 FormData 생성 시 자동으로 boundary 포함해서 설정됨
    } else {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 0) {
        body = buf;
        headers["Content-Type"] = ct;
      }
    }
  }

  const res = await fetch(url, { method, headers, body });

  const responseHeaders = new Headers();
  const rct = res.headers.get("content-type");
  if (rct) responseHeaders.set("content-type", rct);
  const rcd = res.headers.get("content-disposition");
  if (rcd) responseHeaders.set("content-disposition", rcd);

  return new NextResponse(res.body, { status: res.status, headers: responseHeaders });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, "GET");
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, "POST");
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, "DELETE");
}
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, "PUT");
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path, "PATCH");
}
