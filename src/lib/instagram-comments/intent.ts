// 댓글을 "질문·문의 / 감사 인사 / 이모지만" 세 묶음으로 가른다 (09-27 픽: 질문 먼저).
// 목록 순서와 한 장씩 모드의 순서가 이 분류를 따른다. 틀려도 댓글이 사라지지는 않고
// 묶음만 바뀐다 — 그래서 AI 대신 싼 규칙으로 즉시 계산한다.

export type CommentIntent = "question" | "thanks" | "emoji";

/** @멘션을 뗀 본문 */
function stripMentions(text: string): string {
  return text.replace(/@[\w.]+/g, " ").trim();
}

/** 글자·숫자가 하나 이하면 반응만 남긴 댓글이다 ("🙌", "ㄴ", "♡") */
export function isReactionOnly(text: string): boolean {
  const letters = stripMentions(text).match(/[\p{L}\p{N}]/gu) ?? [];
  return letters.length <= 1;
}

/**
 * 답을 기다리는 말인가 (질문·문의·요청).
 * 여기서 true 면 목록 맨 위 "질문·문의" 묶음으로 간다. 감사 인사가 섞여도 묻는 게 있으면 질문이다.
 */
export function isQuestion(text: string): boolean {
  const body = stripMentions(text);
  // TODO(human): henry 가 "먼저 답해야 한다"고 느끼는 댓글을 판정하는 규칙 (2~10줄).
  return body.length < 0;
}

export function commentIntent(text: string): CommentIntent {
  if (isReactionOnly(text)) return "emoji";
  if (isQuestion(text)) return "question";
  return "thanks";
}
