import { NextResponse } from "next/server";
import { syncIfStale } from "@/lib/instagram-comments/sync";
import { view } from "../view";

// POST: 15분 이상 지났으면 인스타에서 동기화한다. 초안은 자동으로 만들지 않는다 —
// 서아님이 최신 게시물(최대 3개)을 골라 [초안 만들기]를 누를 때만 만든다(drafts 라우트).
// 바깥 호출이 따라붙으므로 GET 이 아니라 POST 로만 받는다(proxy.ts 가 Origin 을 검문).
export async function POST() {
  if (!process.env.IG_ACCESS_TOKEN) {
    return NextResponse.json({ error: "not-connected" }, { status: 409 });
  }
  const ledger = await syncIfStale();
  return NextResponse.json(view(ledger));
}
