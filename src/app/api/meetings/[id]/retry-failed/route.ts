// failed 회의를 저장된 오디오·전사에서 다시 돌린다(멱등). 이미 돌거나 끝났으면 그대로 둔다.
import { NextResponse } from "next/server";
import { isValidMeetingId } from "@/lib/meetings/validate";
import { retryFailedMeeting } from "@/lib/meetings/ingest";
import { localAi } from "@/lib/meetings/local-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;
  if (!isValidMeetingId(id)) {
    return NextResponse.json({ error: "잘못된 회의 id" }, { status: 400 });
  }
  const { outcome, meeting } = await retryFailedMeeting(id, { ai: localAi });
  if (outcome === "missing" || !meeting) {
    return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  }
  if (outcome === "no-audio") {
    return NextResponse.json(
      { error: "다시 처리할 오디오·전사 사본이 없습니다" },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, outcome, status: meeting.status }, { status: 202 });
}
