import { NextRequest, NextResponse } from "next/server";
import { isValidMeetingId } from "@/lib/meetings/validate";
import { renameMeeting } from "@/lib/meetings/rename";
import { saveNameAlias } from "@/lib/meetings/name-aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * 이름·단어 일괄 치환. 잘못 전사된 사람 이름을 전사·분석·편지·태그 전체에서
 * 한 번에 바꾼다. 한 글자 from 은 본문 파괴 위험이 커서 거부(예: "나").
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isValidMeetingId(id)) {
    return NextResponse.json({ error: "잘못된 회의 id" }, { status: 400 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      from?: unknown;
      to?: unknown;
    };
    const from = typeof body.from === "string" ? body.from.trim() : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";

    if (from.length < 2) {
      return NextResponse.json(
        { error: "바꿀 단어는 2글자 이상이어야 합니다" },
        { status: 400 }
      );
    }
    if (!to) {
      return NextResponse.json(
        { error: "새 단어를 입력해주세요" },
        { status: 400 }
      );
    }
    if (from === to) {
      return NextResponse.json(
        { error: "같은 단어입니다" },
        { status: 400 }
      );
    }

    const outcome = await renameMeeting(id, from, to);
    if (outcome.kind === "not-found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (outcome.kind === "no-match") {
      return NextResponse.json({ count: 0 });
    }
    const { count } = outcome;

    // 실제로 바뀐 치환은 별칭으로 학습 — 앞으로 새 전사에 자동 적용된다.
    // 별칭 저장 실패가 이미 끝난 치환을 무르지는 않는다.
    let aliasSaved = false;
    try {
      await saveNameAlias(from, to);
      aliasSaved = true;
    } catch (err) {
      console.warn("[meetings] 이름 별칭 저장 실패:", err);
    }
    return NextResponse.json({ count, aliasSaved });
  } catch (e) {
    const message = e instanceof Error ? e.message : "치환 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
