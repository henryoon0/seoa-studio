// DM 쳐내기 초안 — 질문 한 번에 + 근거 보이는 초안.
// AI(claude/codex CLI)가 없으면 AiUnavailableError 가 그대로 올라가고, 화면은 직접 쓰기로 동작한다.
//
// ① 질문 찾기: 여러 대화를 LLM 1회로 훑어, 계정 주인 사정을 알아야 답할 수 있는 대화에만 질문 1개를 만든다.
//    화면은 그 질문들을 한 화면에 모아 한 번에 받는다.
// ② 초안: 기존 DM 초안 프롬프트 + 예전 답장(관계·말투) + 내 최근 게시물 캡션 + 계정 주인의 답 → 말풍선 배열.
//    어떤 근거를 썼는지 함께 돌려줘 화면이 칩으로 보여 준다.

import { generateJson } from "@/lib/ai/generate";
import type { IgMedia } from "../instagram-comments/model";
import { readFacts, readLedger as readCommentsLedger } from "../instagram-comments/storage";
import { pickVoiceExamples } from "../instagram-comments/voice-examples";
import { buildDmDraftPrompt, loadDmPrompt } from "./draft";
import { dmStyleRules, measureDmStyle } from "./dm-style";
import { dmMessageKindLabel, type DmConversation } from "./model";
import { historyBlock } from "./reply-history";
import { readDmLedger } from "./storage";
import { pickHistory } from "./voice-history";

const QUESTIONS_TIMEOUT_MS = 120_000;
const DRAFT_TIMEOUT_MS = 120_000;
const RECENT_POSTS = 6;

export interface BlitzQuestion {
  conversationId: string;
  question: string;
  hint: string;
}

export interface BlitzDraft {
  /** 버전 1 = 짧게(말풍선 1개), 버전 2 = 나눠서(말풍선 2개). 화면은 Tab 으로 둘을 오간다. */
  versions: [string[], string[]];
  basis: {
    post: { text: string; url: string } | null;
    past: string[];
    /** peer = 이 사람에게 보낸 답장, general = 다른 사람들에게 보낸 답장(말투 본보기) */
    pastKind: "peer" | "general";
    answer: string | null;
  };
}

/** 내 마지막 말 이후 상대가 연달아 보낸 말 */
export function inboundBurst(c: DmConversation): string[] {
  const out: string[] = [];
  for (let k = c.messages.length - 1; k >= 0; k--) {
    const m = c.messages[k];
    if (m.fromMe) break;
    const label = dmMessageKindLabel(m);
    out.unshift(m.text || (label ? `(${label})` : "(사진)"));
  }
  return out;
}

function lastMine(c: DmConversation): string {
  return [...c.messages].reverse().find((m) => m.fromMe && m.text)?.text ?? "";
}

function parseQuestions(raw: string, ids: Set<string>): BlitzQuestion[] {
  const parsed = JSON.parse(raw) as { questions?: { id?: string; question?: string; hint?: string }[] };
  return (parsed.questions ?? [])
    .filter((q) => q.id && ids.has(q.id) && q.question?.trim())
    .map((q) => ({ conversationId: q.id!, question: q.question!.trim(), hint: (q.hint ?? "").trim() }));
}

/** 프롬프트가 부르는 계정 주인 이름 */
async function ownerLabel(): Promise<string> {
  return "서아님(심플리홈 @__simplyhome)";
}

/** 내 최근 게시물 — 댓글 동기화가 원장에 모아 둔 캡션 첫 줄. 따로 API 를 부르지 않는다. */
export function recentPosts(media: Record<string, IgMedia>, limit = RECENT_POSTS): IgMedia[] {
  return Object.values(media)
    .filter((m) => m.captionFirstLine.trim())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/** 여러 대화 중 계정 주인의 사정·계획·의견을 알아야 답할 수 있는 것만 골라 질문 1개씩. LLM 1회. */
export async function findContextQuestions(convos: DmConversation[]): Promise<BlitzQuestion[]> {
  if (convos.length === 0) return [];
  const [facts, owner] = await Promise.all([readFacts(), ownerLabel()]);
  const list = convos
    .map((c) => `[${c.id}] @${c.peerUsername}\n  내 마지막 말: ${lastMine(c).replace(/\n/g, " ").slice(0, 120) || "(없음)"}\n  상대: ${inboundBurst(c).join(" / ").replace(/\n/g, " ").slice(0, 400)}`)
    .join("\n");
  const factLines = facts.map((f) => `- ${f.question} → ${f.answer}`).join("\n");
  const prompt = `너는 ${owner}의 DM 비서다. 아래 DM 들에 계정 주인 대신 답장 초안을 쓰기 전에,
계정 주인 본인만 아는 사실(일정·계획·가격·방법·개인 사정·의견)이 있어야 제대로 답할 수 있는 대화를 고른다.

규칙
- 감사·응원·맞장구·안부처럼 사실 없이도 답할 수 있으면 고르지 않는다. 대부분은 고르지 않는다.
- [이미 아는 사실]로 답할 수 있으면 고르지 않는다.
- 고른 대화마다 계정 주인에게 물을 질문 1개. 상대의 말을 옮기지 말고, 비서가 계정 주인 본인의 계획·사실을 확인하는 말로 쓴다. 짧게(25자 안팎), 한 줄로 답할 수 있게.
- hint 는 계정 주인이 할 법한 답의 형식 예시 한 줄.

[이미 아는 사실]
${factLines || "(없음)"}

[DM 목록]
${list}

JSON 만 출력: {"questions":[{"id":"대화 id","question":"...","hint":"예: ..."}]}`;
  const ids = new Set(convos.map((c) => c.id));
  return generateJson({ tier: "fast", prompt, timeoutMs: QUESTIONS_TIMEOUT_MS }, (raw) => parseQuestions(raw, ids));
}

function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 80) ?? "";
}

function cleanBubbles(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((b): b is string => typeof b === "string").map((b) => b.trim()).filter(Boolean).slice(0, 4) : [];
}

function parseDraft(raw: string, postCount: number): { versions: [string[], string[]]; post: number | null } {
  const parsed = JSON.parse(raw) as { short?: unknown; split?: unknown; post?: unknown };
  const short = cleanBubbles(parsed.short);
  const split = cleanBubbles(parsed.split);
  if (short.length === 0 && split.length === 0) throw new Error("빈 초안");
  const post = typeof parsed.post === "number" && parsed.post >= 1 && parsed.post <= postCount ? parsed.post : null;
  return { versions: [short.length ? short : split, split.length ? split : short], post };
}

/** 서아님이 인스타에서 실제로 쓴 답글 중 지금 말과 비슷한 것 (DM 기록이 적을 때도 말투를 잡는다) */
function voiceExamplesBlock(text: string): string {
  const picks = pickVoiceExamples(text, 4);
  if (picks.length === 0) return "";
  const lines = picks.map((e) => `- 받은 말: ${e.comment}\n  서아님: ${e.reply}`).join("\n");
  return `[서아님 실제 답글 — 말투만 따른다. 문장을 베끼지 않는다]\n${lines}`;
}

/** 대화 1건의 말풍선 초안 + 근거 */
export async function draftBlitzReply(c: DmConversation, answer?: string): Promise<BlitzDraft> {
  const [persona, facts, ledger, comments] = await Promise.all([
    loadDmPrompt(),
    readFacts(),
    readDmLedger(),
    readCommentsLedger(),
  ]);
  const history = pickHistory(ledger, c.peerUsername, { peerLimit: 6, generalLimit: 8 });
  const recent = recentPosts(comments.media);
  const ans = answer?.trim() || "";
  const base = buildDmDraftPrompt(persona, c, facts, ans ? `이 대화에 답하는 데 필요한 내 사정: ${ans}` : undefined)
    .replace(/\n답장 본문만 출력한다\. 따옴표·설명·머리말 없이\.$/, "");
  const postLines = recent.map((p, k) => `${k + 1}. ${firstLine(p.captionFirstLine)}`).join("\n") || "(없음)";
  const prompt = `${base}

${historyBlock(history, c.peerUsername)}

[내 최근 인스타 게시물 — 상대 말과 직접 이어질 때만 언급한다. 억지로 끌어오지 않는다]
${postLines}

${voiceExamplesBlock(inboundBurst(c).join(" "))}

${dmStyleRules(measureDmStyle(ledger))}

다른 사람과 나눈 대화의 내용(이름·주문·개인 사정)은 이 사람에게 쓰지 않는다. 예전 답장은 말투만 참고한다.

출력 형식 — 같은 답을 두 버전으로 쓴다
- short: 말풍선 1개로 짧게
- split: 말풍선 2개로 나눠서. 첫 말풍선은 반응, 둘째는 이어지는 말
- 각 말풍선은 한 줄. 두 버전의 첫 문장을 똑같이 쓰지 않는다.
- 최근 글을 실제로 언급했으면 그 번호, 아니면 null.
JSON 만 출력: {"short":["..."],"split":["...","..."],"post":null}`;
  const out = await generateJson({ tier: "fast", prompt, timeoutMs: DRAFT_TIMEOUT_MS }, (raw) => parseDraft(raw, recent.length));
  const used = out.post ? recent[out.post - 1] : null;
  const past = (history.peer.length ? history.peer.map((p) => p.text) : history.general.map((g) => g.text)).slice(0, 3);
  return {
    versions: out.versions,
    basis: {
      post: used ? { text: firstLine(used.captionFirstLine), url: used.permalink } : null,
      past: [...new Set(past.map((t) => [...new Set(t.split("\n").map((l) => l.trim()).filter(Boolean))].join(" ")))],
      pastKind: history.peer.length ? "peer" : "general",
      answer: ans || null,
    },
  };
}
