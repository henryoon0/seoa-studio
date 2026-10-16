/** 서아님이 하는 일의 묶음. 회의 제목과 회의에서 나온 할 일 앞에 `[태그]`로 붙는다. */
export const MEETING_TAGS = [
  "Weekly Meeting",
  "심플리몰",
] as const;

export type MeetingTag = (typeof MEETING_TAGS)[number];

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** AI가 띄어쓰기·대소문자를 달리 써도 목록의 태그로 맞춘다. 목록 밖이면 undefined. */
export function normalizeMeetingTag(value: unknown): MeetingTag | undefined {
  if (typeof value !== "string") return undefined;
  const key = squash(value.replace(/^\[|\]$/g, ""));
  return MEETING_TAGS.find((tag) => squash(tag) === key);
}

/** 제목 맨 앞의 `[태그]`를 읽는다. 사용자가 손으로 단 태그가 AI 판단보다 우선이다. */
export function tagFromTitle(title: string | undefined): MeetingTag | undefined {
  const match = title?.trim().match(/^\[([^\]]+)\]/);
  return match ? normalizeMeetingTag(match[1]) : undefined;
}

/** 이미 `[...]`로 시작하는 제목은 그대로 둔다. */
export function withTagPrefix(text: string, tag: MeetingTag | undefined): string {
  const trimmed = text.trim();
  if (!tag || /^\[[^\]]+\]/.test(trimmed)) return trimmed;
  return `[${tag}] ${trimmed}`;
}

/**
 * 분석이 끝난 회의의 새 제목. 제목에 이미 태그가 있거나 AI가 태그를 못 골랐으면
 * undefined(바꾸지 않음). 제목이 비어 있으면 headline 앞에 태그를 붙인다.
 */
export function taggedMeetingTitle(
  title: string | undefined,
  analysis: { readonly headline: string; readonly tag?: string }
): string | undefined {
  const tag = normalizeMeetingTag(analysis.tag);
  if (!tag || tagFromTitle(title)) return undefined;
  return withTagPrefix(title?.trim() || analysis.headline, tag);
}
