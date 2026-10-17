import { NextRequest, NextResponse } from "next/server";
import { isAiConfigError } from "@/lib/ai-error";
import { findContextQuestions } from "@/lib/instagram-dm/blitz-draft";
import { readDmLedger } from "@/lib/instagram-dm/storage";

// POST: 쳐내기 대상 대화들 중 계정 주인의 사정을 알아야 답할 수 있는 것에만 질문 1개씩 (LLM 1회).
// AI 가 없으면 질문 없이 진행한다 (ai: false).
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { conversationIds?: string[] };
  const ledger = await readDmLedger();
  const convos = (body.conversationIds ?? []).map((id) => ledger.conversations[id]).filter((c) => !!c);
  try {
    return NextResponse.json({ questions: await findContextQuestions(convos), ai: true });
  } catch (error) {
    if (isAiConfigError(error)) return NextResponse.json({ questions: [], ai: false });
    const message = error instanceof Error ? error.message : "질문 찾기 실패";
    return NextResponse.json({ error: message }, { status: /초 안에|timeout/i.test(message) ? 504 : 502 });
  }
}
