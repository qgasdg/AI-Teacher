import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME, type Role } from "@/lib/session";

// crypto(session.ts)는 Node 런타임 전용 — Edge로 떨어지면 모듈 로드부터 실패.
export const runtime = "nodejs";

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
  try {
    return await proxyInner(req, pathParts, method);
  } catch (e) {
    console.error(`[proxy] 처리 중 예외 ${method} /${pathParts.join("/")}:`, e);
    return NextResponse.json(
      { error: "프록시 내부 오류", detail: String(e) },
      { status: 500 },
    );
  }
}

async function proxyInner(req: NextRequest, pathParts: string[], method: string): Promise<NextResponse> {
  const seg = pathParts.filter(Boolean);

  if (!authorize(req, requiredRole(method, seg))) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  // 원본 pathname에서 /api/proxy 접두사만 제거 — trailing slash를 보존한다.
  // (seg.join("/")는 슬래시를 잃어 FastAPI가 307 리다이렉트를 내고,
  //  그 Location이 http:// 다운그레이드라 undici가 Authorization 헤더를 떨궈 401이 됨)
  const subPath = req.nextUrl.pathname.replace(/^\/api\/proxy/, "");
  const qs = req.nextUrl.searchParams.toString();
  const url = `${BACKEND_URL}${subPath}${qs ? `?${qs}` : ""}`;

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

  let res: Response;
  try {
    // 리다이렉트를 직접 처리한다. FastAPI의 trailing-slash 307 Location이
    // http:// 로 다운그레이드되는데, undici가 그 경로를 자동 추종하면
    // 프로토콜 다운그레이드로 간주해 Authorization 헤더를 떨군다 → 401.
    // 따라서 manual로 받고, Location을 https로 강제한 뒤 헤더를 붙여 재요청한다.
    let target = url;
    for (let i = 0; i < 3; i++) {
      res = await fetch(target, { method, headers, body, redirect: "manual" });
      if (res.status !== 307 && res.status !== 308) break;
      const loc = res.headers.get("location");
      if (!loc) break;
      target = new URL(loc, target).toString().replace(/^http:\/\//, "https://");
    }
    res = res!;
  } catch (e) {
    console.error(`[proxy] fetch 실패 ${method} ${url}:`, e);
    return NextResponse.json(
      { error: "백엔드 연결 실패", detail: String(e) },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  const rct = res.headers.get("content-type");
  if (rct) responseHeaders.set("content-type", rct);
  const rcd = res.headers.get("content-disposition");
  if (rcd) responseHeaders.set("content-disposition", rcd);

  return new NextResponse(res.body, { status: res.status, headers: responseHeaders });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path, "GET");
}
export async function POST(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path, "POST");
}
export async function DELETE(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path, "DELETE");
}
export async function PUT(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path, "PUT");
}
export async function PATCH(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path, "PATCH");
}
