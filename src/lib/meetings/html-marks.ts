/**
 * 렌더된 HTML 문자열에 글자-오프셋 기반 형광펜 마크를 끼워 넣는 헬퍼.
 * 문서 탭(마크다운→HTML)처럼 블록이 통짜 HTML 인 경우에 쓴다.
 *
 * 오프셋 기준 = 그 HTML 을 innerHTML 로 넣었을 때의 textContent.
 * (태그 사이 공백 text run 포함, 엔티티는 디코드된 글자 수로 센다 —
 * 클라이언트 Range 캡처가 재는 값과 정확히 일치해야 한다.)
 */

interface Token {
  type: "tag" | "text";
  raw: string;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const close = html.indexOf(">", i);
      if (close === -1) {
        tokens.push({ type: "text", raw: html.slice(i) });
        break;
      }
      tokens.push({ type: "tag", raw: html.slice(i, close + 1) });
      i = close + 1;
    } else {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      tokens.push({ type: "text", raw: html.slice(i, end) });
      i = end;
    }
  }
  return tokens;
}

/** escapeHtml 이 만드는 5종 + 숫자 엔티티만 디코드(우리 렌더러 출력 전제). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeEntities(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** HTML 의 textContent 상당 문자열. */
export function htmlPlainText(html: string): string {
  return tokenize(html)
    .filter((t) => t.type === "text")
    .map((t) => decodeEntities(t.raw))
    .join("");
}

export interface MarkRange {
  id: string;
  start: number;
  end: number;
}

/**
 * 정렬·비겹침 범위를 <mark> 로 얹는다. 범위가 태그 경계를 걸치면
 * text run 별로 잘라 각각 감싼다(태그 중첩 안 깨짐).
 * 스타일은 인라인으로 박는다 — NoteProse 의 `[&_mark]` emerald 규칙이
 * 클래스보다 세서, 인라인이 아니면 문서 탭에서 색이 뒤집힌다.
 */
export function applyMarksToHtml(html: string, ranges: MarkRange[]): string {
  const sorted = [...ranges]
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return html;
  const out: string[] = [];
  let offset = 0;
  for (const token of tokenize(html)) {
    if (token.type === "tag") {
      out.push(token.raw);
      continue;
    }
    const text = decodeEntities(token.raw);
    const runStart = offset;
    const runEnd = offset + text.length;
    offset = runEnd;
    const hits = sorted.filter((r) => r.start < runEnd && r.end > runStart);
    if (!hits.length) {
      out.push(token.raw);
      continue;
    }
    let cursor = 0;
    for (const r of hits) {
      const from = Math.max(0, r.start - runStart);
      const to = Math.min(text.length, r.end - runStart);
      if (from > cursor) out.push(encodeEntities(text.slice(cursor, from)));
      // id 는 속성에 박히므로 안전한 문자만 통과(속성 탈출 차단).
      const safeId = r.id.replace(/[^\w-]/g, "");
      out.push(
        `<mark class="hl" data-hl-id="${safeId}" style="background:rgba(252,211,77,0.55);color:inherit;border-radius:3px;padding:1px 1px;cursor:pointer">${encodeEntities(
          text.slice(from, to)
        )}</mark>`
      );
      cursor = to;
    }
    if (cursor < text.length) out.push(encodeEntities(text.slice(cursor)));
  }
  return out.join("");
}
