// AI 답글 초안 생성. 말투는 voice/VOICE.md(서아님 말투 규격)를 따른다.
// 예시는 원장의 서아님 실제 답글 + voice/db/replies.jsonl 에서 비슷한 답글을 고른다.
// data/instagram-reply-prompt.md 를 만들면 그 파일이 VOICE.md 보다 먼저다.
import { readFile } from "fs/promises";
import path from "path";
import { generateJson } from "@/lib/ai/generate";
import { parseJsonObject } from "@/lib/ai/json";
import {
  harvestToneExamples,
  personHistory,
  type DraftOption,
  type DraftTone,
  type IgCommentLedger,
  type IgLedgerComment,
  own,
} from "./model";
import { type StoredFact } from "./storage";
import { loadVoiceSpec, pickVoiceExamples } from "./voice-examples";

export function replyPromptPath(): string {
  return process.env.INSTAGRAM_REPLY_PROMPT_PATH ?? path.join(process.cwd(), "data", "instagram-reply-prompt.md");
}

export const DEFAULT_REPLY_PROMPT = `너는 박서아(심플리홈, @__simplyhome)가 되어 인스타그램 내 게시물에 달린 단비님 댓글에 답글을 쓴다.

말투 규칙:
- 해요체. 상대 말을 먼저 받는다("와! ~군요!!", "좋아요 좋아요!!").
- 짧게 1~3문장. 댓글 내용에 구체적으로 반응한다(복붙 티가 나면 안 됨).
- 끝에 ❤️ 나 🤍 를 1~2개. ㅋㅋ·ㅎㅎ 는 가볍게.
- 확실하지 않은 사실(공구 일정·가격·제품 정보)은 지어내지 않는다.`;

export async function loadReplyPrompt(): Promise<string> {
  try {
    const raw = await readFile(replyPromptPath(), "utf8");
    if (raw.trim()) return raw.trim();
  } catch {}
  const spec = loadVoiceSpec();
  return spec
    ? `너는 박서아(심플리홈, @__simplyhome)가 되어 인스타그램 내 게시물에 달린 단비님 댓글에 답글을 쓴다. 아래 말투 규격의 "댓글 답글" 채널 규칙을 따른다.\n\n${spec}`
    : DEFAULT_REPLY_PROMPT;
}

function factsBlock(facts: StoredFact[]): string {
  if (facts.length === 0) return "";
  const lines = facts.map((f) => `- ${f.question} → ${f.answer}`).join("\n");
  return `\n[서아님이 알려준 사실 — 답변에 필요할 때만 자연스럽게 사용]\n${lines}\n`;
}

function examplesBlock(examples: { comment: string; reply: string }[]): string {
  if (examples.length === 0) return "";
  const lines = examples
    .map((e, i) => `예시 ${i + 1}\n댓글: ${e.comment}\n내 답글: ${e.reply}`)
    .join("\n\n");
  return `\n[서아님의 실제 과거 답글 — 이 톤을 그대로 따른다. 문장을 베끼지 않는다]\n${lines}\n`;
}

function historyBlock(ledger: IgCommentLedger, comment: IgLedgerComment): string {
  const history = personHistory(ledger, comment.username, comment.id);
  if (history.items.length === 0) return "";
  const lines = history.items
    .slice(0, 5)
    .map((i) => {
      const reply = i.myReplyText ? ` / 내 답글: ${i.myReplyText}` : "";
      return `- ${i.timestamp.slice(0, 10)} "${i.text}"${reply}`;
    })
    .join("\n");
  return `\n[이 사람과의 과거 교류 — 맥락이 이어지면 자연스럽게 반영]\n${lines}\n`;
}

export interface DraftContext {
  ledger: IgCommentLedger;
  comment: IgLedgerComment;
  facts: StoredFact[];
  /** 재생성 방향 지시 또는 거친 메모 ("더 짧게", "공구 마감 언급") */
  instruction?: string;
}

/** outputRule = 마지막 출력 형식 지시 (후보 3개 JSON 규칙) */
export function buildDraftPrompt(persona: string, ctx: DraftContext, outputRule: string): string {
  const { ledger, comment } = ctx;
  const media = own(ledger.media, comment.mediaId);
  const parts: string[] = [persona];
  // 원장의 내 답글을 먼저, 모자라면 말투 DB 에서 비슷한 답글로 채운다
  const mine = harvestToneExamples(ledger, 4);
  parts.push(examplesBlock([...mine, ...pickVoiceExamples(comment.text, 8 - mine.length)]));
  parts.push(factsBlock(ctx.facts));
  parts.push(historyBlock(ledger, comment));
  parts.push(
    `\n[지금 답할 댓글]\n게시물: ${media?.captionFirstLine ?? "(캡션 없음)"} (${media?.timestamp?.slice(0, 10) ?? ""})\n작성자: @${comment.username}\n댓글: ${comment.text}`
  );
  if (ctx.instruction?.trim()) {
    parts.push(
      `\n[서아님의 지시/메모 — 최우선으로 반영해서 완성한다]\n${ctx.instruction.trim()}`
    );
  }
  parts.push(outputRule);
  return parts.filter(Boolean).join("\n");
}

// ── 후보 3개 (09-27 픽: "초안 3개 중 고르기", 한 번에 생성해서 미리 들어가 있게) ──

// 한 번 호출에 3개를 받는다. 세 번 부르면 비용·시간이 3배이고, 같은 맥락을 본 한 호출이
// 결이 더 확실히 갈린다. 대기줄 발송은 따로라 여기 시간 예산은 한 건 기준이다.
const OPTIONS_TIMEOUT_MS = 180_000;

const TONE_ORDER: DraftTone[] = ["short", "warm", "guide"];

const OPTIONS_GUIDE = `
[세 가지 결로 하나씩 쓴다]
- short: 한 문장. 가볍게 받아주는 답.
- warm: 1~3문장. 댓글 내용에 구체적으로 반응하는 따뜻한 답. 기본으로 보낼 글이다.
- guide: warm 결에 다음 행동 안내를 한 문장 붙인다(공구·심플리몰·DM 문의). 모르는 일정·가격은 지어내지 않는다.
JSON 하나만 출력한다: {"short": "...", "warm": "...", "guide": "..."}`;

/** AI 응답(임의 JSON)을 후보 목록으로 좁힌다. 하나도 없으면 던진다. */
export function parseReplyOptions(raw: Record<string, unknown>): DraftOption[] {
  const options = TONE_ORDER.flatMap((tone) => {
    const value = raw[tone];
    if (typeof value !== "string") return [];
    const text = value.trim().replace(/^["“]|["”]$/g, "").trim();
    return text ? [{ tone, text }] : [];
  });
  if (options.length === 0) throw new Error("초안 후보가 비어 있어요");
  return options;
}

/** 댓글 1건의 후보 3개 생성. 지시(instruction)가 있으면 세 결 모두에 반영한다. */
export async function generateReplyOptions(ctx: DraftContext): Promise<DraftOption[]> {
  const persona = await loadReplyPrompt();
  const parsed = await generateJson<Record<string, unknown>>(
    {
      tier: "reasoning",
      prompt: buildDraftPrompt(persona, ctx, OPTIONS_GUIDE),
      timeoutMs: OPTIONS_TIMEOUT_MS,
      jsonSchema: {
        type: "object",
        properties: { short: { type: "string" }, warm: { type: "string" }, guide: { type: "string" } },
        required: ["short", "warm", "guide"],
      },
    },
    (text) => parseJsonObject<Record<string, unknown>>(text)
  );
  return parseReplyOptions(parsed);
}

// ── 선질문 (#66): 답변에 필요한데 모르는 정보를 먼저 묻는다 ──

export interface ScanQuestionsInput {
  comments: { username: string; text: string }[];
  mediaCaptions: string[];
  facts: StoredFact[];
}

/**
 * 미답글 묶음을 훑어, 답글을 쓰려면 서아님에게 물어봐야 하는 정보를 추린다.
 * 이미 facts 에 답이 있는 건 다시 묻지 않는다. 없으면 빈 배열.
 */
export async function scanQuestions(input: ScanQuestionsInput): Promise<string[]> {
  const questionable = input.comments.filter((c) => c.text.trim().length > 0);
  if (questionable.length === 0) return [];
  const known = input.facts.map((f) => `- ${f.question} → ${f.answer}`).join("\n") || "(없음)";
  const commentLines = questionable.map((c) => `- @${c.username}: ${c.text}`).join("\n");
  const prompt = `인스타그램 내 게시물(${input.mediaCaptions.join(" / ") || "캡션 없음"})에 달린 댓글들에 답글을 달려고 한다.

[댓글들]
${commentLines}

[이미 아는 사실]
${known}

답글을 쓰는 데 꼭 필요한데 위 "이미 아는 사실"에 없는 정보만 질문으로 추려라 (예: 다음 공구 일정, 가격, 제품 정보). 감사 인사·응원처럼 정보 없이 답할 수 있는 댓글은 질문을 만들지 않는다. 없으면 빈 배열.`;
  const parsed = await generateJson<{ questions?: unknown }>(
    {
      tier: "reasoning",
      prompt,
      jsonSchema: {
        type: "object",
        properties: { questions: { type: "array", items: { type: "string" } } },
        required: ["questions"],
      },
    },
    (raw) => parseJsonObject<{ questions?: unknown }>(raw)
  );
  const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
  return questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 5);
}
