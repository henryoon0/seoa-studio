import { NextRequest, NextResponse } from "next/server";
import {
  aliasInputError,
  listNameAliases,
  removeNameAlias,
  saveNameAlias,
} from "@/lib/meetings/name-aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 저장된 이름 별칭 목록 — 새 회의 전사에 자동 적용되는 매핑. */
export async function GET() {
  return NextResponse.json({ aliases: await listNameAliases() });
}

/**
 * 별칭 직접 추가/갱신. "이름 일괄 변경"이 count>0 일 때 자동 저장하지만,
 * 이미 고쳐 둔 회의처럼 지금 바꿀 곳이 없는 매핑은 여기로 직접 등록한다.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    from?: unknown;
    to?: unknown;
  };
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const invalid = aliasInputError(from, to);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }
  try {
    return NextResponse.json({ aliases: await saveNameAlias(from, to) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "별칭 저장 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** 별칭 삭제. body: { from } */
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { from?: unknown };
  const from = typeof body.from === "string" ? body.from.trim() : "";
  if (!from) {
    return NextResponse.json({ error: "from 이 필요합니다" }, { status: 400 });
  }
  try {
    return NextResponse.json({ aliases: await removeNameAlias(from) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "별칭 삭제 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
