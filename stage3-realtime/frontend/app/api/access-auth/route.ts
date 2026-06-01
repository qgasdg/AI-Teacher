import { NextRequest, NextResponse } from "next/server";
import { signToken, COOKIE_NAME } from "@/lib/session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD ?? "";
  if (!ACCESS_PASSWORD) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }
  const { password } = await req.json();
  if (password !== ACCESS_PASSWORD) {
    return NextResponse.json({ error: "비밀번호가 틀렸습니다." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME.access, signToken("access"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12시간
  });
  return res;
}
