import { NextResponse } from "next/server";
import { syncNow } from "@/lib/instagram-comments/sync";

// POST: 수동 [지금 동기화]. 읽기 전용 API 호출만 한다 (발송 없음).
export async function POST() {
  const ledger = await syncNow();
  if (ledger.sync.lastError) {
    return NextResponse.json({ error: ledger.sync.lastError }, { status: 502 });
  }
  // 끝까지 못 읽은 동기화는 성공으로 알리지 않는다. 읽은 만큼은 저장됐으니 200 + ok:false + 안내.
  if (ledger.sync.incomplete) {
    return NextResponse.json({ ok: false, incomplete: ledger.sync.incomplete, lastSyncAt: ledger.sync.lastSyncAt });
  }
  return NextResponse.json({ ok: true, lastSyncAt: ledger.sync.lastSyncAt });
}
