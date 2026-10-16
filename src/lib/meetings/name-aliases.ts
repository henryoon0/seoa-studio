// 이름 별칭(alias) — "이름 일괄 변경"으로 고친 오전사 이름을 기억해 두고,
// 이후 모든 새 회의 전사에 자동 적용한다(같은 이름을 회의마다 다시 고치지 않게).
//
// 저장: data/meetings/name-aliases.json (MEETINGS_DATA_DIR 를 따라간다).
// 적용: ingest 전사 직후(1분 청크 부분 저장 포함). 분석·문서·공유본은 교정된
//   전사를 재료로 쓰므로 별도 적용이 필요 없다.
// 치환 방식: rename.ts 와 동일한 부분 문자열 치환(한글 이름엔 단어 경계가 없다).
//   한 글자 from 은 본문 파괴 위험이 커서 저장 자체를 거부한다(2글자 이상).

import path from "node:path";
import { readJsonAt, writeJsonAt } from "@/lib/json-store";
import { loadMeetingGlossary } from "./glossary";
import type { MeetingTranscript } from "./types";

export interface NameAlias {
  /** 잘못 전사되는 표기 (2글자 이상). */
  from: string;
  /** 올바른 이름. */
  to: string;
  createdAt: string;
}

interface AliasFile {
  aliases: NameAlias[];
}

function aliasesPath(): string {
  const dir =
    process.env.MEETINGS_DATA_DIR ||
    path.join(process.cwd(), "data", "meetings");
  return path.join(dir, "name-aliases.json");
}

function isValidAlias(a: unknown): a is NameAlias {
  if (!a || typeof a !== "object") return false;
  const { from, to } = a as { from?: unknown; to?: unknown };
  return (
    typeof from === "string" &&
    typeof to === "string" &&
    from.trim().length >= 2 &&
    to.trim().length > 0 &&
    from !== to
  );
}

export async function listNameAliases(): Promise<NameAlias[]> {
  const data = await readJsonAt<AliasFile>(aliasesPath(), { aliases: [] });
  return Array.isArray(data.aliases) ? data.aliases.filter(isValidAlias) : [];
}

/**
 * 별칭 추가/갱신 규칙(순수). 목록이 항상 "한 바퀴 순서 적용으로 끝나는" 상태를
 * 유지하도록 정리한다:
 * - 같은 from 이 있으면 새 to 로 대체.
 * - from 이 새 to 와 같은 별칭(역방향)은 교정된 이름을 되돌리므로 제거.
 * - X→from 이던 사슬은 X→to 로 압축.
 */
export function upsertAlias(
  aliases: NameAlias[],
  from: string,
  to: string,
  createdAt: string
): NameAlias[] {
  const next = aliases
    .filter((a) => a.from !== from && a.from !== to)
    .map((a) => (a.to === from ? { ...a, to } : a))
    .filter((a) => a.from !== a.to);
  next.push({ from, to, createdAt });
  return next;
}

/** 입력 검증 실패 메시지. 통과하면 null. rename 라우트와 규칙이 같다. */
export function aliasInputError(from: string, to: string): string | null {
  if (from.length < 2) return "바꿀 단어는 2글자 이상이어야 합니다";
  if (!to) return "새 단어를 입력해주세요";
  if (from === to) return "같은 단어입니다";
  return null;
}

export async function saveNameAlias(
  from: string,
  to: string
): Promise<NameAlias[]> {
  const f = from.trim();
  const t = to.trim();
  const invalid = aliasInputError(f, t);
  if (invalid) throw new Error(invalid);
  const aliases = upsertAlias(
    await listNameAliases(),
    f,
    t,
    new Date().toISOString()
  );
  await writeJsonAt(aliasesPath(), { aliases });
  return aliases;
}

export async function removeNameAlias(from: string): Promise<NameAlias[]> {
  const aliases = (await listNameAliases()).filter((a) => a.from !== from);
  await writeJsonAt(aliasesPath(), { aliases });
  return aliases;
}

/** 텍스트 하나에 모든 별칭을 목록 순서대로 적용한다. */
export function applyAliasesToText(
  text: string,
  aliases: NameAlias[]
): string {
  let out = text;
  for (const { from, to } of aliases) {
    if (!out.includes(from)) continue;
    // "동현→유동현"처럼 바른 표기가 틀린 표기를 품으면, 이미 바른 곳은 건너뛴다
    // (안 그러면 "유동현"이 "유유동현"이 된다).
    out = to.includes(from)
      ? out
          .split(to)
          .map((part) => part.split(from).join(to))
          .join(to)
      : out.split(from).join(to);
  }
  return out;
}

/** 전사(segments+plain)에 별칭을 적용한다. 바뀐 곳이 없으면 원본을 그대로 돌려준다. */
export function applyAliasesToTranscript(
  transcript: MeetingTranscript,
  aliases: NameAlias[]
): MeetingTranscript {
  if (!aliases.length) return transcript;
  let changed = false;
  const sub = (s: string): string => {
    const next = applyAliasesToText(s, aliases);
    if (next !== s) changed = true;
    return next;
  };
  const segments = transcript.segments.map((seg) => ({
    ...seg,
    speaker: sub(seg.speaker),
    text: sub(seg.text),
  }));
  const plain = sub(transcript.plain);
  return changed ? { ...transcript, segments, plain } : transcript;
}

/** 저장된 별칭 + 용어집의 잘못 들린 표기를 지금 기준으로 전사에 다시 적용한다. */
export async function applyCurrentAliases(
  transcript: MeetingTranscript
): Promise<MeetingTranscript> {
  const glossary = await loadMeetingGlossary();
  const aliases = [...(await listNameAliases()), ...glossary.corrections];
  return applyAliasesToTranscript(transcript, aliases);
}
