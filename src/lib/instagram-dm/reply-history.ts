// 계정 주인의 실제 답장 히스토리 — 초안이 예전 답장의 말투·관계를 따라가게 한다.
// 원장(ledger.json)에 쌓인 내 DM 이 진짜 말투의 출처다.
//
// ⚠ 핵심: **버스트로 묶어야 한다.** 사람들은 한 번의 대답을 짧은 메시지 여러 개로 쪼개
// 연달아 보낸다. 메시지 단위로 세지 말고, 10분 안의 연속 발신을
// 하나로 묶어야 "한 번의 답장"이 된다. 단위를 잘못 잡으면 통계가 "짧게 쓴다"고 거짓말한다.

import type { DmLedger, DmMessage } from "./model";

/** 한 번의 대답 = 연속 발신 묶음. 이 창을 넘어가면 다른 대답으로 본다. */
const BURST_GAP_MS = 10 * 60 * 1000;

export interface ReplyBurst {
  readonly peerUsername: string;
  /** 이 답장이 반응한 상대의 마지막 말 (스토리 언급은 대개 빈 문자열) */
  readonly peerText: string;
  /** 상대 메시지가 스토리 언급·스토리 답장이었는지 */
  readonly storyKind?: "mention" | "reply_to";
  /** 묶인 답장 전문 (줄바꿈으로 이어 붙임) */
  readonly text: string;
  /** 묶인 메시지 개수 */
  readonly parts: number;
  readonly at: string;
}

function parseTime(iso: string | undefined): number {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
}

/**
 * 원장을 "한 번의 답장" 단위로 편다. 정렬은 원장 순서를 믿지 않고 시각으로 다시 한다
 * (병합 누적 원장이라 순서가 어긋날 수 있다).
 */
export function collectReplyBursts(ledger: DmLedger): ReplyBurst[] {
  const out: ReplyBurst[] = [];
  for (const conv of Object.values(ledger.conversations)) {
    const msgs = [...(conv.messages ?? [])].sort(
      (a, b) => parseTime(a.createdTime) - parseTime(b.createdTime)
    );
    let parts: DmMessage[] = [];
    let context: DmMessage | undefined;
    let lastAt = 0;
    const flush = () => {
      if (parts.length === 0) return;
      out.push({
        peerUsername: conv.peerUsername,
        peerText: (context?.text ?? "").trim(),
        storyKind: context?.story?.kind,
        text: parts.map((m) => m.text.trim()).join("\n"),
        parts: parts.length,
        at: parts[parts.length - 1].createdTime,
      });
      parts = [];
    };
    for (const m of msgs) {
      const at = parseTime(m.createdTime);
      if (m.fromMe) {
        if (!m.text?.trim()) continue;
        if (parts.length > 0 && at - lastAt > BURST_GAP_MS) flush();
        parts.push(m);
      } else {
        flush();
        context = m;
      }
      lastAt = at;
    }
    flush();
  }
  return out.sort((a, b) => parseTime(b.at) - parseTime(a.at));
}

// ── 말투 학습에 독이 되는 것들 ────────────────────────────────────────────────
// 안내 템플릿(단톡방 링크·라이브 공지)과 업무 회신은 내가 실제로 쓴 글이지만
// 평소 말투와는 정반대다. 예시로 넣으면 모델이 격식체로 끌려간다.
const TEMPLATE_MARKERS = [
  "http://",
  "https://",
  "안내 링크",
  "단톡방",
  "입금 계좌",
  "카카오뱅크",
  "회신드립니다",
  "드림",
];

/** 답례 예시로 쓸 만한 답장인가 (안내 템플릿·업무 회신·순수 이모지 제외) */
export function isVoiceSample(burst: ReplyBurst): boolean {
  const text = burst.text;
  if (TEMPLATE_MARKERS.some((m) => text.includes(m))) return false;
  // 자모·이모지·문장부호만 남으면 말투 예시가 못 된다 ("ㅋㅋㅋㅋ", "💗")
  const letters = text.replace(/[^가-힣a-zA-Z]/g, "");
  if (letters.length < 4) return false;
  return true;
}

/**
 * 같은 문구를 여러 사람에게 반복해 보낸 것은 템플릿이다 (한 번만 남긴다).
 * 정규화 후 첫 등장만 통과시킨다.
 */
export function dropRepeats(bursts: ReplyBurst[]): ReplyBurst[] {
  const seen = new Set<string>();
  const out: ReplyBurst[] = [];
  for (const b of bursts) {
    const key = b.text.replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

export interface HistoryPick {
  /** 바로 그 사람과 주고받은 답장 — 관계의 결(호칭·존댓말 수위·농담 허용치)이 여기 있다 */
  readonly peer: ReadonlyArray<{ readonly peerText: string; readonly text: string }>;
  /** 다른 사람들에게 쓴 답장 — 형식(길이·줄 구성)의 본보기 */
  readonly general: ReadonlyArray<{ readonly text: string }>;
}

/** 프롬프트에 넣을 히스토리 블록. 비어 있으면 빈 문자열(초기 상태에서는 규칙만으로 쓴다). */
export function historyBlock(pick: HistoryPick, peerUsername: string): string {
  const lines: string[] = [];
  if (pick.peer.length > 0) {
    lines.push(`# 내가 예전에 @${peerUsername} 님에게 실제로 보낸 답장`);
    lines.push(`이 사람과의 관계·호칭·농담 수위가 여기 담겨 있다. 이어지는 대화처럼 답해라.`);
    for (const b of pick.peer) {
      if (b.peerText) lines.push(`- (상대: ${b.peerText.replace(/\n/g, " ").slice(0, 60)})`);
      lines.push(`  나: ${b.text.replace(/\n/g, " ⏎ ")}`);
    }
    lines.push("");
  }
  if (pick.general.length > 0) {
    lines.push(`# 내가 다른 분들 스토리·메시지에 실제로 보낸 답장`);
    lines.push(`말투와 줄 구성의 본보기다. 베끼지 말고 결만 가져와라.`);
    for (const b of pick.general) {
      lines.push(`- ${b.text.replace(/\n/g, " ⏎ ")}`);
    }
  }
  return lines.join("\n");
}
