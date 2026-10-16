import { NextRequest, NextResponse } from "next/server";
import { discoverPerson } from "@/lib/instagram-comments/discovery";

// 작성자 계정 조회 (#64). GET ?username=... — 캐시(3일) 우선, 프로 계정만 결과가 있다.
export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")?.trim();
  if (!username) {
    return NextResponse.json({ error: "username이 필요합니다" }, { status: 400 });
  }
  const entry = await discoverPerson(username);
  return NextResponse.json(entry);
}
