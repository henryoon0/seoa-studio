import { NextResponse } from "next/server";
import { syncDmNow } from "@/lib/instagram-dm/sync";

// POST: 수동 [지금 동기화]. 읽기 전용 API 호출만 한다 (발송 없음).
export async function POST() {
  const ledger = await syncDmNow();
  if (ledger.sync.lastError) {
    return NextResponse.json({ error: ledger.sync.lastError }, { status: 502 });
  }
  return NextResponse.json({ ok: true, lastSyncAt: ledger.sync.lastSyncAt });
}
