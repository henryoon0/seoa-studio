// 고아 처리 잡 재개. recorded/transcribed 상태인데 돌고 있지 않으면 다시 띄운다(멱등).
// 상세 GET 은 읽기 전용이라 재개는 이 POST 가 맡는다.
import { NextResponse } from "next/server";
import { getMeeting } from "@/lib/meetings/store";
import { isValidMeetingId } from "@/lib/meetings/validate";
import { maybeResumeProcessing } from "@/lib/meetings/ingest";
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
  const meeting = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  }
  maybeResumeProcessing(meeting, { ai: localAi });
  return NextResponse.json({ ok: true, status: meeting.status });
}
