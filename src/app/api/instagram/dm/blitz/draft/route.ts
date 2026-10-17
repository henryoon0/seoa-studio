import { NextRequest, NextResponse } from "next/server";
import { isAiConfigError } from "@/lib/ai-error";
import { draftBlitzReply } from "@/lib/instagram-dm/blitz-draft";
import { setDmDraft } from "@/lib/instagram-dm/model";
import { readDmLedger, writeDmLedger } from "@/lib/instagram-dm/storage";

// POST: 대화 1건의 말풍선 초안 + 근거. 발송 아님 — 초안은 원장에도 남긴다(줄바꿈 = 말풍선).
// AI 가 없으면 503 + aiUnavailable: 화면은 초안 없이 직접 쓰기로 계속한다.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { conversationId?: string; answer?: string };
  const id = body.conversationId?.trim();
  if (!id) return NextResponse.json({ error: "conversationId가 필요합니다" }, { status: 400 });
  const convo = (await readDmLedger()).conversations[id];
  if (!convo) return NextResponse.json({ error: "해당 대화가 원장에 없습니다" }, { status: 404 });
  try {
    const draft = await draftBlitzReply(convo, body.answer);
    // 생성 중 동기화가 원장을 바꿨을 수 있어 다시 읽고 쓴다
    await writeDmLedger(setDmDraft(await readDmLedger(), id, draft.versions[0].join("\n")));
    return NextResponse.json(draft);
  } catch (error) {
    if (isAiConfigError(error)) return NextResponse.json({ error: error.message, aiUnavailable: true }, { status: 503 });
    const message = error instanceof Error ? error.message : "초안 생성 실패";
    return NextResponse.json({ error: message }, { status: /초 안에|timeout/i.test(message) ? 504 : 502 });
  }
}
