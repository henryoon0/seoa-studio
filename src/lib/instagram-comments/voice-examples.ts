// 서아님 말투 예시 고르기. voice/db/replies.jsonl(인스타에서 모은 서아님 실제 답글)에서
// 지금 댓글과 단어가 많이 겹치는 답글을 고른다. 앱을 처음 켜서 원장(내 답글 기록)이
// 비어 있어도 초안이 서아님 말투를 따르게 하려는 것이다.
import { readFileSync } from "node:fs";
import path from "node:path";

interface VoiceReply {
  question: string | null;
  reply: string;
  auto: boolean;
}

let cache: VoiceReply[] | null = null;

function voiceDir(): string {
  return process.env.SEOA_VOICE_DIR ?? path.join(process.cwd(), "voice");
}

function loadReplies(): VoiceReply[] {
  if (cache) return cache;
  try {
    const raw = readFileSync(path.join(voiceDir(), "db", "replies.jsonl"), "utf8");
    cache = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as VoiceReply)
      // 공구 자동 안내 문구와 한 마디 답글은 말투 예시로 쓰지 않는다
      .filter((r) => !r.auto && r.question && r.reply.length >= 12);
  } catch {
    cache = [];
  }
  return cache;
}

/** 한글 2글자 이상 덩어리로 자른다. 조사까지 붙은 말도 앞 2글자로 겹침을 본다. */
function terms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.match(/[가-힣A-Za-z0-9]{2,}/g) ?? []) out.add(w.slice(0, 2));
  return out;
}

/** 지금 댓글과 비슷한 서아님 답글 max 개. 겹치는 말이 없으면 길이가 적당한 답글로 채운다. */
export function pickVoiceExamples(commentText: string, max = 6): { comment: string; reply: string }[] {
  const pool = loadReplies();
  if (pool.length === 0) return [];
  const want = terms(commentText);
  const scored = pool.map((r, i) => {
    let score = 0;
    for (const t of terms(r.question ?? "")) if (want.has(t)) score += 1;
    return { r, score, i };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, max).map(({ r }) => ({ comment: r.question ?? "", reply: r.reply }));
}

/** voice/VOICE.md 전체. 없으면 null. */
export function loadVoiceSpec(): string | null {
  try {
    return readFileSync(path.join(voiceDir(), "VOICE.md"), "utf8").trim() || null;
  } catch {
    return null;
  }
}
