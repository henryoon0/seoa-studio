import { NextRequest, NextResponse } from "next/server";
import {
  setDraft,
  setSkipped,
  own,
} from "@/lib/instagram-comments/model";
import { readLedger, updateLedger } from "@/lib/instagram-comments/storage";
import { view } from "./view";

// GET: 원장 조회만 한다(읽기 전용). 동기화·초안 만들기는 POST /refresh.
export async function GET() {
  if (!process.env.IG_ACCESS_TOKEN) {
    return NextResponse.json({ error: "not-connected" }, { status: 409 });
  }
  return NextResponse.json(view(await readLedger()));
}

// PATCH: 초안 저장 / 건너뛰기 토글 (로컬 원장만 변경, 발송 아님)
export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as {
    commentId?: string;
    draft?: string;
    skipped?: boolean;
  };
  if (!body.commentId) {
    return NextResponse.json({ error: "commentId가 필요합니다" }, { status: 400 });
  }
  const commentId = body.commentId;
  let missing = false;
  const ledger = await updateLedger((latest) => {
    if (!own(latest.comments, commentId)) {
      missing = true;
      return latest;
    }
    let next = latest;
    if (typeof body.draft === "string") next = setDraft(next, commentId, body.draft);
    if (typeof body.skipped === "boolean") next = setSkipped(next, commentId, body.skipped);
    return next;
  });
  if (missing) {
    return NextResponse.json({ error: "해당 댓글이 원장에 없습니다" }, { status: 404 });
  }
  return NextResponse.json(view(ledger));
}
