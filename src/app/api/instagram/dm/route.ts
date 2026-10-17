import { NextRequest, NextResponse } from "next/server";
import {
  canReplyNow,
  dmMessageKindLabel,
  lastMessage,
  needsClassification,
  pendingConversations,
  repliedConversations,
  setDmDraft,
  setDmSkipped,
  skippedConversations,
  windowClosesAt,
  type DmConversation,
  type DmLedger,
} from "@/lib/instagram-dm/model";
import { readDmLedger, writeDmLedger } from "@/lib/instagram-dm/storage";
import { triageDm } from "@/lib/instagram-dm/triage";
import { syncDmIfStale } from "@/lib/instagram-dm/sync";
import { personHistory, type IgCommentLedger } from "@/lib/instagram-comments/model";
import { readLedger as readCommentsLedger } from "@/lib/instagram-comments/storage";

/** 사람 카드: 이 DM 상대가 내 게시물 댓글로도 교류하던 사람인지 (username 으로 연결) */
function commentHistoryFor(commentsLedger: IgCommentLedger, peerUsername: string) {
  if (!peerUsername || peerUsername === "(알 수 없음)") return null;
  if (!commentsLedger.people[peerUsername]) return null;
  const h = personHistory(commentsLedger, peerUsername);
  return {
    summary: `댓글 교류 ${h.interactionCount}회`,
    items: h.items.slice(0, 5).map((i) => ({
      id: i.id,
      text: i.text,
      timestamp: i.timestamp,
      myReplyText: i.myReplyText ?? null,
    })),
  };
}

function decorate(c: DmConversation, nowMs: number) {
  const { triage, reason } = triageDm(c);
  return {
    triage,
    triageReason: reason,
    id: c.id,
    peerUsername: c.peerUsername,
    profileUrl:
      c.peerUsername && c.peerUsername !== "(알 수 없음)"
        ? `https://www.instagram.com/${c.peerUsername}/`
        : null,
    updatedTime: c.updatedTime,
    lastText: (() => {
      const last = lastMessage(c);
      if (!last) return "";
      return last.text || (dmMessageKindLabel(last) ? `(${dmMessageKindLabel(last)})` : "");
    })(),
    messages: c.messages,
    canReply: canReplyNow(c, nowMs),
    draft: c.draft ?? "",
    purpose: c.purpose ?? null,
    windowClosesAt: windowClosesAt(c),
  };
}

async function view(ledger: DmLedger) {
  const nowMs = Date.now();
  const commentsLedger = await readCommentsLedger();
  const withHistory = (c: DmConversation) => ({
    ...decorate(c, nowMs),
    commentHistory: commentHistoryFor(commentsLedger, c.peerUsername),
  });
  return {
    pending: pendingConversations(ledger).map(withHistory),
    replied: repliedConversations(ledger).map(withHistory),
    skipped: skippedConversations(ledger).map(withHistory),
    unclassified: Object.values(ledger.conversations).filter(needsClassification).length,
    sync: ledger.sync,
  };
}

// GET: 원장 조회. 15분 이상 지났으면 자동 동기화 (앱 열 때 따라잡기).
export async function GET() {
  const ledger = await syncDmIfStale();
  return NextResponse.json(await view(ledger));
}

// PATCH: 초안 저장 / 건너뛰기 토글 (로컬 원장만 변경, 발송 아님)
export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as {
    conversationId?: string;
    /** 여러 대화를 한 번에 건너뜀 (DM 쳐내기의 "모두 정리") */
    conversationIds?: string[];
    draft?: string;
    skipped?: boolean;
  };
  if (body.conversationIds && typeof body.skipped === "boolean") {
    let ledger = await readDmLedger();
    for (const id of body.conversationIds) ledger = setDmSkipped(ledger, id, body.skipped);
    await writeDmLedger(ledger);
    return NextResponse.json(await view(ledger));
  }
  if (!body.conversationId) {
    return NextResponse.json({ error: "conversationId가 필요합니다" }, { status: 400 });
  }
  let ledger = await readDmLedger();
  if (!ledger.conversations[body.conversationId]) {
    return NextResponse.json({ error: "해당 대화가 원장에 없습니다" }, { status: 404 });
  }
  if (typeof body.draft === "string") ledger = setDmDraft(ledger, body.conversationId, body.draft);
  if (typeof body.skipped === "boolean") ledger = setDmSkipped(ledger, body.conversationId, body.skipped);
  await writeDmLedger(ledger);
  return NextResponse.json(await view(ledger));
}
