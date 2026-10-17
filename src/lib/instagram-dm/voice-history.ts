// 초안용 히스토리 — 내가 실제로 보낸 DM 답장(원장)에서 두 묶음을 고른다.
//
// 두 묶음을 따로 뽑는 이유: 그 사람과의 과거 대화는 **관계**를 알려주고(전에 뭘 했고
// 어떻게 불렀는지), 남들에게 쓴 답장은 **형식**을 알려준다(줄 구성·길이). 하나로 섞으면
// 처음 답하는 사람에게는 형식만, 단골에게는 관계만 남는다.

import type { DmLedger } from "./model";
import { collectReplyBursts, dropRepeats, isVoiceSample, type HistoryPick } from "./reply-history";
import { readDmLedger } from "./storage";

/** 순수 함수: 원장에서 최신순으로 고른다. 기록이 없으면 빈 묶음(규칙만으로 쓴다). */
export function pickHistory(
  ledger: DmLedger,
  peerUsername: string,
  { peerLimit = 6, generalLimit = 10 }: { peerLimit?: number; generalLimit?: number } = {}
): HistoryPick {
  const bursts = collectReplyBursts(ledger).filter(isVoiceSample);
  const peer = bursts.filter((b) => b.peerUsername === peerUsername).slice(0, peerLimit);
  const general = dropRepeats(bursts.filter((b) => b.peerUsername !== peerUsername)).slice(0, generalLimit);
  return {
    peer: peer.map((b) => ({ peerText: b.peerText, text: b.text })),
    general: general.map((b) => ({ text: b.text })),
  };
}

export async function loadHistoryFor(
  peerUsername: string,
  limits: { peerLimit?: number; generalLimit?: number } = {}
): Promise<HistoryPick> {
  return pickHistory(await readDmLedger(), peerUsername, limits);
}
