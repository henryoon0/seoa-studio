import { NextRequest, NextResponse } from "next/server";
import { own } from "@/lib/instagram-comments/model";
import { QueueConflictError, queueCounts } from "@/lib/instagram-comments/queue-model";
import { checkUnknownReply, enqueueAndStart, removeFromQueue, resendAfterCheck } from "@/lib/instagram-comments/send-queue";
import { readLedger, readSendQueue } from "@/lib/instagram-comments/storage";

// 발송 대기줄 (#81, D11). POST {items:[{commentId,message}]} 로 화면이 승인한 문구를 그대로 담고 시작,
// GET 으로 진행 폴링(조회만), DELETE {commentId} 로 발송 전 회수. 실패 항목 재시도 = 같은 id 로 다시 POST.
// PATCH {commentId} = henry 가 인스타에서 직접 확인한 뒤 "확인했어요, 다시 보내기" (unknown 만).
// PATCH {commentId, action:"check"} = "인스타에서 다시 확인" — 조회만 한다 (발송 없음).
// 한 번이라도 인스타에 요청한 항목의 문구 변경·회수는 409 로 거절한다.
// (예전 형식 {commentIds} 는 원장의 초안을 읽는다 — 승인 뒤 초안이 바뀔 수 있어 새 화면은 items 를 쓴다.)

/** 시도 이력 규칙 위반은 409 + 화면에 그대로 보일 한국어 문구. 나머지 오류는 그대로 던진다. */
async function conflictAs409<T>(run: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof QueueConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

function view(state: Awaited<ReturnType<typeof readSendQueue>>) {
  return { ...state, counts: queueCounts(state) };
}

export async function GET() {
  // 조회만 한다. 끊긴 줄의 재개는 POST(enqueueAndStart)와 서버 시작(instrumentation)이 맡는다.
  const state = await readSendQueue();
  return NextResponse.json(view(state));
}

type Requested = { commentId: string; message?: string };

function parseRequested(body: { items?: unknown; commentIds?: unknown }): Requested[] | string {
  if (Array.isArray(body.items)) {
    const out: Requested[] = [];
    for (const raw of body.items) {
      const r = raw as { commentId?: unknown; message?: unknown };
      if (typeof r?.commentId !== "string" || !r.commentId.trim()) return "commentId가 필요합니다";
      const message = typeof r.message === "string" ? r.message.trim() : "";
      if (!message) return "보낼 답글이 비어 있어요. 글을 채운 뒤 보내주세요.";
      out.push({ commentId: r.commentId.trim(), message });
    }
    return out;
  }
  if (Array.isArray(body.commentIds)) {
    return body.commentIds
      .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      .map((id) => ({ commentId: id.trim() }));
  }
  return [];
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { items?: unknown; commentIds?: unknown };
  const requested = parseRequested(body);
  if (typeof requested === "string") return NextResponse.json({ error: requested }, { status: 400 });
  if (requested.length === 0) {
    return NextResponse.json({ error: "items(commentId·message)가 필요합니다" }, { status: 400 });
  }
  const ledger = await readLedger();
  const entries: { commentId: string; message: string }[] = [];
  for (const r of requested) {
    const c = own(ledger.comments, r.commentId);
    if (!c) return NextResponse.json({ error: `원장에 없는 댓글이 있어요 (${r.commentId}). 먼저 동기화하세요.` }, { status: 404 });
    if (c.repliedByMe) continue; // 이미 답글 단 건 조용히 제외
    const message = r.message ?? (c.draft ?? "").trim();
    if (!message) {
      return NextResponse.json({ error: `@${c.username} 댓글의 답글이 비어 있어요. 초안을 먼저 채워주세요.` }, { status: 400 });
    }
    entries.push({ commentId: r.commentId, message });
  }
  if (entries.length === 0) {
    return NextResponse.json({ error: "보낼 항목이 없어요 (전부 이미 답글 완료)." }, { status: 400 });
  }
  const state = await conflictAs409(() => enqueueAndStart(entries));
  return state instanceof NextResponse ? state : NextResponse.json(view(state));
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as { commentId?: string };
  if (!body.commentId) {
    return NextResponse.json({ error: "commentId가 필요합니다" }, { status: 400 });
  }
  const commentId = body.commentId;
  const state = await conflictAs409(() => removeFromQueue(commentId));
  return state instanceof NextResponse ? state : NextResponse.json(view(state));
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { commentId?: unknown; action?: unknown };
  if (typeof body.commentId !== "string" || !body.commentId.trim()) {
    return NextResponse.json({ error: "commentId가 필요합니다" }, { status: 400 });
  }
  const commentId = body.commentId.trim();
  if (body.action === "check") return NextResponse.json(view(await checkUnknownReply(commentId)));
  const state = await conflictAs409(() => resendAfterCheck(commentId));
  return state instanceof NextResponse ? state : NextResponse.json(view(state));
}
