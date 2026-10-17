import { NextRequest, NextResponse } from "next/server";
import { blitzConversationStatus, type BlitzQueueState } from "@/lib/instagram-dm/blitz-queue";
import { enqueueBlitzReply, resumeBlitzQueue, startBlitzRunner } from "@/lib/instagram-dm/blitz-send";
import { measureDmStyle } from "@/lib/instagram-dm/dm-style";
import { canReplyNow } from "@/lib/instagram-dm/model";
import { readBlitzQueue, readDmLedger } from "@/lib/instagram-dm/storage";

function view(state: BlitzQueueState) {
  return { status: state.status, stopReason: state.stopReason ?? null, conversations: blitzConversationStatus(state) };
}

// GET: 대기줄 상태 + 내 DM 말투 수치(화면의 "말풍선이 평소보다 많음" 기준).
// running 인데 러너가 없으면(앱 재시작) 다시 기동 — 멱등.
export async function GET() {
  const [state, ledger] = await Promise.all([readBlitzQueue(), readDmLedger()]);
  if (state.status === "running") startBlitzRunner();
  return NextResponse.json({ ...view(state), style: measureDmStyle(ledger) });
}

// POST {conversationId, bubbles}: 계정 주인이 ⏎ 로 승인한 답장을 줄에 담는다. {resume:true}: 멈춘 줄 다시 시작.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { conversationId?: string; bubbles?: string[]; resume?: boolean };
  if (body.resume) return NextResponse.json(view(await resumeBlitzQueue()));
  const id = body.conversationId?.trim();
  const bubbles = (body.bubbles ?? []).map((b) => b.trim()).filter(Boolean);
  if (!id || bubbles.length === 0) return NextResponse.json({ error: "conversationId와 bubbles가 필요합니다" }, { status: 400 });
  const convo = (await readDmLedger()).conversations[id];
  if (!convo) return NextResponse.json({ error: "해당 대화가 원장에 없습니다" }, { status: 404 });
  if (!canReplyNow(convo, Date.now())) {
    return NextResponse.json({ error: "24시간이 지나 앱에서 보내야 해요" }, { status: 409 });
  }
  return NextResponse.json(view(await enqueueBlitzReply(id, bubbles)));
}
