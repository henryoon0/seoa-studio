import { NextResponse } from "next/server";
import { syncIfStale } from "@/lib/instagram-comments/sync";
import { ensureDraftOptions } from "@/lib/instagram-comments/draft-job";
import { view } from "../view";

// POST: 15분 이상 지났으면 인스타에서 동기화하고, 초안 후보가 없는 댓글의 초안 만들기를 시작한다.
// 바깥 호출·Claude 작업이 따라붙으므로 GET 이 아니라 POST 로만 받는다(proxy.ts 가 Origin 을 검문).
export async function POST() {
  if (!process.env.IG_ACCESS_TOKEN) {
    return NextResponse.json({ error: "not-connected" }, { status: 409 });
  }
  const ledger = await syncIfStale();
  void ensureDraftOptions().catch(() => {});
  return NextResponse.json(view(ledger));
}
