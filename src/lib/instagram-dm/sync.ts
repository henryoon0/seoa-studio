// DM 수집(폴링) 파이프: 대화 목록+최근 메시지 → 원장 병합. 앱을 열 때 + stale 기준으로 호출된다.
// webhook 없이 댓글과 같은 폴링 방식 — 로컬 dev 서버는 공개 주소가 없어서 이게 유일한 길이다.
import { fetchMe, refreshTokenIfNeeded, resolveAccessToken } from "../instagram-comments/graph";
import { fetchConversations } from "./graph";
import { upsertConversations, type DmLedger } from "./model";
import { readDmLedger, writeDmLedger } from "./storage";

export const DM_SYNC_STALE_MS = 15 * 60 * 1000; // 15분 (댓글과 동일)

export function isDmStale(ledger: DmLedger, nowMs = Date.now()): boolean {
  if (!ledger.sync.lastSyncAt) return true;
  return nowMs - Date.parse(ledger.sync.lastSyncAt) > DM_SYNC_STALE_MS;
}

/** 실동기화. 성공 시 갱신된 원장을 저장하고 돌려준다. 실패는 lastError 로 남긴다. */
export async function syncDmNow(): Promise<DmLedger> {
  await refreshTokenIfNeeded();
  const token = await resolveAccessToken();
  const ledger = await readDmLedger();
  try {
    const rawMe = await fetchMe(token);
    const me = { userId: rawMe.user_id, username: rawMe.username };
    // 마지막 동기화 이후 움직임이 있는 대화까지 페이지를 따라간다 (첫 동기화면 maxPages 만큼)
    const fetched = await fetchConversations(token, me, { sinceIso: ledger.sync.lastSyncAt });
    const next = upsertConversations(ledger, fetched, me, new Date().toISOString());
    await writeDmLedger(next);
    return next;
  } catch (error) {
    const next: DmLedger = {
      ...ledger,
      sync: { ...ledger.sync, lastError: error instanceof Error ? error.message : String(error) },
    };
    await writeDmLedger(next);
    return next;
  }
}

/** stale 이면 동기화, 아니면 저장된 원장 그대로. */
export async function syncDmIfStale(): Promise<DmLedger> {
  const ledger = await readDmLedger();
  if (!isDmStale(ledger)) return ledger;
  return syncDmNow();
}
