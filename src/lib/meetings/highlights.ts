import type { Meeting, MeetingAnalysis } from "./types";
import { renderNoteMarkdownToHtml } from "@/lib/collection-notes/note-markdown";
import { htmlPlainText } from "./html-marks";

/**
 * 형광펜 하이라이트 — 요약(analysis)·스크립트(transcript) 어디든, 블록 안의
 * 글자 범위 단위로 색칠한다. 블록은 안정 키(key)로 지목한다:
 *
 *   summary            analysis.summary
 *   topic:<ti>:<pi>    analysis.topics[ti].points[pi]
 *   key:<i>            analysis.keyPoints[i]
 *   decision:<i>       analysis.decisions[i]
 *   action:<i>         analysis.actionItems[i].task
 *   next:<i>           analysis.nextSteps[i]
 *   question:<i>       analysis.openQuestions[i]
 *   seg:<segmentId>    transcript 세그먼트 텍스트
 *   doc:<templateId>   생성 문서 — 마크다운을 HTML 로 렌더한 것의 textContent
 *
 * exact 는 저장 시점의 실제 문자열 스냅샷 — 본문이 바뀌면(재분석·편집)
 * sanitize 가 재앵커링을 시도하고, 실패하면 그 하이라이트를 조용히 버린다.
 */
export interface TextHighlight {
  id: string;
  key: string;
  /** 블록 텍스트 안의 글자 오프셋(반열림 [start, end)). */
  start: number;
  end: number;
  exact: string;
}

const HIGHLIGHTS_MAX = 500;

export type HighlightSource = Pick<
  Meeting,
  "analysis" | "transcript" | "docs"
>;

/** 문서 블록의 기준 텍스트 = 렌더된 HTML 의 textContent (캡처 오프셋 기준). */
export function docPlainText(markdown: string): string {
  return htmlPlainText(renderNoteMarkdownToHtml(markdown));
}

/** key → 해당 블록의 원본 문자열. 없는 키면 undefined. */
export function resolveBlockText(
  meeting: HighlightSource,
  key: string
): string | undefined {
  const a = meeting.analysis;
  if (key === "summary") return a?.summary;
  const [kind, ...rest] = key.split(":");
  if (kind === "seg") {
    const id = rest.join(":");
    return meeting.transcript?.segments.find((s) => s.id === id)?.text;
  }
  if (kind === "doc") {
    const templateId = rest.join(":");
    const doc = meeting.docs?.find((d) => d.templateId === templateId);
    return doc?.content ? docPlainText(doc.content) : undefined;
  }
  const listOf = (analysis: MeetingAnalysis | undefined) => {
    switch (kind) {
      case "key":
        return analysis?.keyPoints;
      case "decision":
        return analysis?.decisions;
      case "next":
        return analysis?.nextSteps;
      case "question":
        return analysis?.openQuestions;
      default:
        return undefined;
    }
  };
  if (kind === "topic") {
    const ti = Number(rest[0]);
    const pi = Number(rest[1]);
    if (!Number.isInteger(ti) || !Number.isInteger(pi)) return undefined;
    return a?.topics?.[ti]?.points[pi];
  }
  if (kind === "action") {
    const i = Number(rest[0]);
    if (!Number.isInteger(i)) return undefined;
    return a?.actionItems?.[i]?.task;
  }
  const list = listOf(a);
  if (list) {
    const i = Number(rest[0]);
    if (!Number.isInteger(i)) return undefined;
    return list[i];
  }
  return undefined;
}

/**
 * 클라이언트 페이로드 정제: 실제 블록 텍스트와 대조해 어긋난 항목을
 * 재앵커링(indexOf)하거나 버리고, 같은 블록의 겹치는 범위를 병합한다.
 */
export function sanitizeHighlights(
  raw: unknown,
  meeting: HighlightSource
): TextHighlight[] {
  if (!Array.isArray(raw)) return [];
  const anchored: TextHighlight[] = [];
  for (const item of raw.slice(0, HIGHLIGHTS_MAX)) {
    if (!item || typeof item !== "object") continue;
    const h = item as Partial<TextHighlight>;
    if (
      typeof h.key !== "string" ||
      typeof h.exact !== "string" ||
      !h.exact.length ||
      !Number.isInteger(h.start) ||
      !Number.isInteger(h.end)
    ) {
      continue;
    }
    const text = resolveBlockText(meeting, h.key);
    if (!text) continue;
    let start = h.start as number;
    let end = h.end as number;
    if (start < 0 || end > text.length || end <= start) {
      const found = text.indexOf(h.exact);
      if (found < 0) continue;
      start = found;
      end = found + h.exact.length;
    } else if (text.slice(start, end) !== h.exact) {
      const found = text.indexOf(h.exact);
      if (found < 0) continue;
      start = found;
      end = found + h.exact.length;
    }
    // id 는 HTML 속성으로 나가므로 저장 시점에 안전 문자로 정규화한다.
    const rawId = typeof h.id === "string" ? h.id.replace(/[^\w-]/g, "") : "";
    anchored.push({
      id: rawId || `hl-${start}-${end}`,
      key: h.key,
      start,
      end,
      exact: text.slice(start, end),
    });
  }

  // 같은 블록의 겹치거나 맞닿은 범위 병합(렌더러가 중첩을 다루지 않아도 되게).
  const byKey = new Map<string, TextHighlight[]>();
  for (const h of anchored) {
    const list = byKey.get(h.key) ?? [];
    list.push(h);
    byKey.set(h.key, list);
  }
  const out: TextHighlight[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.start - b.start);
    const text = resolveBlockText(meeting, key)!;
    let cur: TextHighlight | null = null;
    for (const h of list) {
      if (cur && h.start <= cur.end) {
        const prev: TextHighlight = cur;
        const end = Math.max(prev.end, h.end);
        cur = { ...prev, end, exact: text.slice(prev.start, end) };
      } else {
        if (cur) out.push(cur);
        cur = { ...h };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export interface TextPart {
  text: string;
  highlightId?: string;
}

/** 블록 텍스트를 하이라이트 경계로 쪼갠다(겹침은 sanitize 가 이미 병합). */
export function splitByHighlights(
  text: string,
  highlights: TextHighlight[]
): TextPart[] {
  const ranges = highlights
    .filter((h) => h.start < text.length && h.end > h.start)
    .map((h) => ({
      id: h.id,
      start: Math.max(0, h.start),
      end: Math.min(text.length, h.end),
    }))
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return [{ text }];
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) parts.push({ text: text.slice(cursor, r.start) });
    parts.push({ text: text.slice(r.start, r.end), highlightId: r.id });
    cursor = r.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

/**
 * 공유 제외 블록 키 정제 — 실제 존재하는 블록만 남긴다.
 * (재분석으로 사라진 키는 여기서 자연 소멸.)
 */
export function sanitizeHiddenBlocks(
  raw: unknown,
  meeting: HighlightSource
): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter(
        (k): k is string =>
          typeof k === "string" &&
          // 문서는 통짜 블록이라 "빼기" 대상이 아니다(공유 팝오버 체크로 뺀다).
          !k.startsWith("doc:") &&
          resolveBlockText(meeting, k) !== undefined
      )
    ),
  ].slice(0, HIGHLIGHTS_MAX);
}

