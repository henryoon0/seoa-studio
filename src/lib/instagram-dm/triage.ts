// DM 두 칸 나누기 — 답장 안 해도 되는 DM까지 하나하나 답하지 않게.
// 답장 = 글로 답할 것, 정리 = 대화가 이미 끝났거나 스토리 답례로 갈 것.
// AI 를 새로 부르지 않는다: 규칙 + 이미 저장된 목적 분류(purpose)만 쓴다. AI 가 없어도 똑같이 나뉜다.

import type { DmConversation, DmMessage } from "./model";

export type DmTriage = "reply" | "done";
export type DmTriageReason = "질문" | "문의" | "스토리 언급" | "이모지" | "마무리 인사" | "대화";

/** 내 마지막 말 이후 상대가 연달아 보낸 말 */
function inboundBurst(c: DmConversation): DmMessage[] {
  const out: DmMessage[] = [];
  for (let k = c.messages.length - 1; k >= 0 && !c.messages[k].fromMe; k--) out.unshift(c.messages[k]);
  return out;
}

const EMOJI_OR_SPACE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]/gu;
/** 대화를 끝내는 말: 감사·넵·알겠어요류 + 웃음·기호 */
const CLOSER = /^(네+|넵+|넹+|넴+|네넵|넵넵|예+|감사합니다|감사해요|감사드려요|고맙습니다|고마워요|알겠습니다|알겠어요|확인했습니다|접수했습니다|좋아요|굿|최고|ㅋ+|ㅎ+|ㅠ+|ㄷ+)+$/;

/** 문장 하나가 끝맺는 말인가: 기호·웃음·~^ 를 걷어낸 몸통으로 본다 */
function isCloser(text: string): boolean {
  const core = text.replace(EMOJI_OR_SPACE, "").replace(/[!~^.,;:)(\-ㅎㅋㅠㅜ]+$/u, "").replace(/[!~^.,]/g, "");
  return core.length === 0 || CLOSER.test(core);
}

export function triageDm(c: DmConversation): { triage: DmTriage; reason: DmTriageReason } {
  const burst = inboundBurst(c);
  const texts = burst.map((m) => m.text.trim()).filter(Boolean);
  if (texts.some((t) => /[?？]/.test(t))) return { triage: "reply", reason: "질문" };
  if (texts.length === 0) {
    return burst.some((m) => m.story) ? { triage: "done", reason: "스토리 언급" } : { triage: "done", reason: "이모지" };
  }
  if (texts.every((t) => t.replace(EMOJI_OR_SPACE, "").length === 0)) return { triage: "done", reason: "이모지" };
  // 문의 대화라도 상대가 "넵 감사합니다"로 끝냈으면 대화는 끝난 것이다
  if (texts.every(isCloser)) return { triage: "done", reason: "마무리 인사" };
  if (c.purpose === "inquiry" || c.purpose === "collab") return { triage: "reply", reason: "문의" };
  return { triage: "reply", reason: "대화" };
}
