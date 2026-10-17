// 계정 주인의 DM 말투 — 원장에 쌓인 "내가 보낸 답장"을 직접 세서 얻는다.
// 초안 프롬프트와 쳐내기 화면(말풍선 개수 경고)이 같은 숫자를 쓴다.
// 답장이 적으면(MIN_REPLIES 미만) 숫자가 흔들리므로 무난한 기본값을 쓴다.

import type { DmLedger } from "./model";
import { collectReplyBursts } from "./reply-history";

export interface DmStyle {
  /** 실제로 센 값이면 true, 기록이 적어 기본값이면 false */
  measured: boolean;
  /** 센 답장 수 (10분 묶음 = 한 번의 답장) */
  replies: number;
  /** 답장 한 번의 말풍선 개수 분포 (%) */
  parts: { one: number; two: number; three: number; more: number };
  /** 평소 범위 — 답장의 80% 이상이 이 개수 안. 넘으면 화면이 "평소보다 많음"으로 본다 */
  usualMaxBubbles: number;
  medianChars: number;
  p75Chars: number;
  /** "!!" 가 들어간 말풍선 비율 (%) */
  bangPct: number;
  /** 이모지가 들어간 말풍선 비율 (%) */
  emojiPct: number;
  topEmojis: string[];
}

export const MIN_REPLIES = 20;

export const DEFAULT_DM_STYLE: DmStyle = {
  measured: false,
  replies: 0,
  parts: { one: 55, two: 30, three: 10, more: 5 },
  usualMaxBubbles: 2,
  medianChars: 20,
  p75Chars: 35,
  bangPct: 10,
  emojiPct: 10,
  topEmojis: [],
};

const EMOJI = /\p{Extended_Pictographic}/gu;

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function partsOf(counts: number[]): DmStyle["parts"] {
  const n = counts.length;
  return {
    one: pct(counts.filter((c) => c === 1).length, n),
    two: pct(counts.filter((c) => c === 2).length, n),
    three: pct(counts.filter((c) => c === 3).length, n),
    more: pct(counts.filter((c) => c >= 4).length, n),
  };
}

function usualMax(parts: DmStyle["parts"]): number {
  if (parts.one >= 80) return 1;
  if (parts.one + parts.two >= 80) return 2;
  return 3;
}

function topEmojis(bubbles: string[], k = 3): string[] {
  const count = new Map<string, number>();
  for (const b of bubbles) for (const e of b.match(EMOJI) ?? []) count.set(e, (count.get(e) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([e]) => e);
}

/** 원장에서 내가 보낸 답장을 세어 말투 수치를 낸다. 답장이 MIN_REPLIES 미만이면 기본값. */
export function measureDmStyle(ledger: DmLedger): DmStyle {
  const bursts = collectReplyBursts(ledger);
  if (bursts.length < MIN_REPLIES) return { ...DEFAULT_DM_STYLE, replies: bursts.length };
  const bubbles = Object.values(ledger.conversations).flatMap((c) =>
    c.messages.filter((m) => m.fromMe && m.text.trim()).map((m) => m.text.trim())
  );
  const lengths = bubbles.map((b) => [...b].length).sort((a, b) => a - b);
  const parts = partsOf(bursts.map((b) => b.parts));
  return {
    measured: true,
    replies: bursts.length,
    parts,
    usualMaxBubbles: usualMax(parts),
    medianChars: quantile(lengths, 0.5),
    p75Chars: quantile(lengths, 0.75),
    bangPct: pct(bubbles.filter((b) => b.includes("!!")).length, bubbles.length),
    emojiPct: pct(bubbles.filter((b) => b.match(EMOJI)).length, bubbles.length),
    topEmojis: topEmojis(bubbles),
  };
}

/** 초안 프롬프트용 말투 수치 규칙 */
export function dmStyleRules(s: DmStyle): string {
  const head = s.measured
    ? `[내 DM 말투 실측 — 내가 보낸 답장 ${s.replies}번]`
    : `[DM 말투 기본값 — 내 답장 기록이 아직 적어 무난한 길이를 쓴다]`;
  const emojis = s.topEmojis.length ? ` 자주 쓰는 이모지: ${s.topEmojis.join(" ")}.` : "";
  return `${head}
- 한 번의 답장을 말풍선 1개(${s.parts.one}%)나 2개(${s.parts.two}%)로 보낸다. ${s.usualMaxBubbles + 1}개 이상은 할 말이 많을 때만.
- 말풍선 하나는 ${s.medianChars}자 안팎, 길어도 ${s.p75Chars}자 정도.
- "!!"는 ${s.bangPct}%, 이모지는 ${s.emojiPct}%의 말풍선에만 쓴다.${emojis}`;
}
