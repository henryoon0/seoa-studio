import { NextRequest, NextResponse } from "next/server";
import { generateReplyOptions } from "@/lib/instagram-comments/drafts";
import { own, setDraftOptions } from "@/lib/instagram-comments/model";
import { readFacts, readLedger, updateLedger } from "@/lib/instagram-comments/storage";

// 댓글 1건 재생성 (#66). instruction = henry 의 한 줄 지시("더 짧게") 또는 거친 메모
// (비어 있으면 그냥 새 초안). 후보 3개를 다시 만들고 보낼 글도 새 따뜻하게 버전으로 바꾼다.
// 동기 처리 — 한 건은 수십 초 안에 끝난다.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { commentId?: string; instruction?: string };
  const commentId = body.commentId?.trim();
  if (!commentId) {
    return NextResponse.json({ error: "commentId가 필요합니다" }, { status: 400 });
  }
  const ledger = await readLedger();
  const comment = own(ledger.comments, commentId);
  if (!comment) {
    return NextResponse.json({ error: "해당 댓글이 원장에 없습니다. 먼저 동기화하세요." }, { status: 404 });
  }
  try {
    const facts = await readFacts();
    const options = await generateReplyOptions({ ledger, comment, facts, instruction: body.instruction });
    const next = await updateLedger((latest) => setDraftOptions(latest, commentId, options, { replaceDraft: true }));
    return NextResponse.json({ draft: own(next.comments, commentId)?.draft ?? "", options });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "초안 생성 실패" },
      { status: 502 }
    );
  }
}
