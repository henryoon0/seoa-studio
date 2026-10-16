import { NextRequest, NextResponse } from "next/server";
import { own } from "@/lib/instagram-comments/model";
import { QueueConflictError } from "@/lib/instagram-comments/queue-model";
import { enqueueAndStart } from "@/lib/instagram-comments/send-queue";
import { readLedger } from "@/lib/instagram-comments/storage";

// POST: 답글 1건을 발송 대기줄에 담는다. 직접 보내지 않는다 —
// 모든 발송은 대기줄 러너 한 곳에서 잠금·간격·시간당 상한을 지나 나간다 (중복 발송 방지).
export async function POST(request: NextRequest) {
  const body = (await request.json()) as { commentId?: string; message?: string };
  const commentId = body.commentId?.trim();
  const message = body.message?.trim();
  if (!commentId || !message) {
    return NextResponse.json({ error: "commentId와 message가 필요합니다" }, { status: 400 });
  }

  const ledger = await readLedger();
  const comment = own(ledger.comments, commentId);
  if (!comment) {
    return NextResponse.json({ error: "해당 댓글이 원장에 없습니다. 먼저 동기화하세요." }, { status: 404 });
  }
  if (comment.repliedByMe) {
    return NextResponse.json({ error: "이미 답글을 단 댓글입니다" }, { status: 409 });
  }

  let state;
  try {
    state = await enqueueAndStart([{ commentId, message }]);
  } catch (error) {
    // 이미 인스타에 요청한 항목을 다른 문구로 다시 담으려 함 — 거절한다.
    if (error instanceof QueueConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  const item = state.items.find((i) => i.commentId === commentId);
  return NextResponse.json(
    { ok: true, queued: true, status: item?.status ?? "queued", message: item?.message ?? message },
    { status: 202 }
  );
}
