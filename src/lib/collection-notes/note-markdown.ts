// 검토 모달 미리보기용 최소 마크다운 → HTML 렌더러. 의존성 없이(react-markdown 미설치)
// 수집노트가 쓰는 부분집합만 처리한다: 제목·볼드·==하이라이트==·인라인 코드·인용/콜아웃·
// 목록·표·펜스 코드블럭·문단. 입력은 항상 escape 후 변환하므로 draft 의 임의 HTML 은 렌더되지 않는다.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 미리보기에서 프론트매터(---...---)는 숨긴다. */
export function stripFrontmatter(md: string): string {
  const s = md.replace(/^﻿/, "");
  if (s.startsWith("---")) {
    const end = s.indexOf("\n---", 3);
    if (end !== -1) return s.slice(end + 4).replace(/^\s*\n/, "");
  }
  return md;
}

/**
 * 이미지 주소로 허용할 것. javascript: 같은 스킴이 src 로 들어가지 못하게 막는다.
 * 통과: 앱 내부 경로(/api/…), http(s), data:image.
 */
function safeImageSrc(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (url.startsWith("/")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(url)) return url;
  return null;
}

/** 속성값에 넣을 때는 따옴표까지 막아야 한다. */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function inline(text: string): string {
  // 이미지는 escape 전에 잡아낸다. 주소에 & 가 들어가면 escape 후에는 못 알아본다.
  // 자리를 표식으로 비워 두고, 나머지 서식을 다 입힌 뒤 마지막에 되꽂는다.
  // 표식에 NUL 을 쓰는 건 본문에 그대로 등장할 일이 없고 escapeHtml 이 건드리지 않아서다.
  const images: string[] = [];
  const withMarkers = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (all, alt, src) => {
    const safe = safeImageSrc(src);
    if (!safe) return all; // 못 믿을 주소는 그냥 글자로 남긴다
    images.push(`<img src="${escapeAttr(safe)}" alt="${escapeAttr(alt)}" loading="lazy">`);
    return `\u0000${images.length - 1}\u0000`;
  });

  const rendered = escapeHtml(withMarkers)
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");

  return rendered.replace(/\u0000(\d+)\u0000/g, (_, n) => images[Number(n)]);
}

function isTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  if (!isTableLine(line)) return false;
  const cells = splitTableRow(line);
  // GFM 구분자 셀은 대시 1개부터 유효 (:-, --:, - 전부) — remark-gfm(사이트)과 동일 기준
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(rows: string[]): string {
  let header: string[] | null = null;
  let bodyRows = rows;
  if (rows.length >= 2 && isTableSeparator(rows[1])) {
    header = splitTableRow(rows[0]);
    bodyRows = rows.slice(2);
  }
  const parts: string[] = ['<div class="cn-table"><table>'];
  if (header) {
    parts.push(
      `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`
    );
  }
  const body = bodyRows
    .filter((row) => !isTableSeparator(row))
    .map(
      (row) =>
        `<tr>${splitTableRow(row)
          .map((c) => `<td>${inline(c)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  parts.push(`<tbody>${body}</tbody>`);
  parts.push("</table></div>");
  return parts.join("");
}

export interface NoteMarkdownOptions {
  /**
   * 강의 교안 확장. 교안만 쓰는 관례 두 가지를 켠다:
   * ① `**하면 된다! …**` 실습 블록을 단계(①②③…)까지 묶어 <section> 으로 감싼다.
   * ② 언어 없는 펜스를 요약 상자/입력 블록으로 갈라 서로 다르게 그린다.
   * 수집노트 쪽 호출은 옵션 없이 그대로라 기존 화면은 변하지 않는다.
   */
  readonly lecture?: boolean;
}

/** 언어 없는 펜스의 두 쓰임새. 교안이 ``` 를 요약 상자와 입력(프롬프트·명령) 둘 다에 쓴다. */
export type BareFenceKind = "summary" | "input";

/**
 * 언어 없는 펜스 내용을 보고 요약 상자인지 입력 블록인지 가른다.
 * vault 실측(2026-08-17): 요약 신호는 "핵심 정리"(88건)·"[한눈에 정리]" 같은
 * `[제목]` 첫 줄(16건+)·"세션 = 대화 한 묶음" 같은 ` = ` 용어 풀이 줄.
 * 입력 신호는 /clear 같은 슬래시 명령·claude CLI·"~해줘/~해 주세요" 프롬프트.
 */
export function classifyBareFence(lines: readonly string[]): BareFenceKind {
  const body = lines.map((l) => l.trim()).filter(Boolean);
  if (body.length === 0) return "input";
  // 제목 줄이 있으면 그 자체로 요약. "/resume = …" 같은 용어 풀이도 슬래시 명령보다
  // 먼저 본다 — ` = ` 는 입력에 등장할 일이 없는 요약 전용 신호라서다.
  if (summaryTitleOf(body[0])) return "summary";
  // 용어 풀이 상자는 "세션 = 대화 한 묶음" 처럼 첫 줄이 정의로 시작한다. 정의가
  // 여러 줄로 감싸 접히면 비율이 희석되므로(실측: 1,912개 중 수백 건) 첫 줄을 먼저 본다.
  if (/ = | → |\s=$/.test(body[0])) return "summary";
  // "설치 선택지 정리" 같은 제목 한 줄로 시작하는 상자. 문장부호 없이 짧게 끝나는
  // 제목만 본다 — "~정리해줘." 같은 프롬프트는 문장부호 때문에 안 걸린다.
  if (body[0].length <= 30 && /(정리|핵심|요약|한눈에 보기)\)?$/.test(body[0])) return "summary";
  const glossary = body.filter((l) => / = | → /.test(l)).length;
  if (glossary * 2 >= body.length) return "summary";
  // 확신 없으면 입력. 쳐 넣을 프롬프트가 요약 카드로 보이는 쪽이 더 해롭다.
  return "input";
}

/** 요약 상자의 제목 줄. "핵심 정리" 또는 "[한눈에 정리]" 처럼 대괄호로 감싼 첫 줄. */
function summaryTitleOf(first: string): string | null {
  const t = first.trim();
  if (!t) return null;
  const bracket = t.match(/^\[(.+)\]$/);
  if (bracket) return bracket[1];
  if (/^핵심 정리$/.test(t)) return t;
  return null;
}

function renderBareFence(codeLines: string[], kind: BareFenceKind): string {
  if (kind === "summary") {
    let body = codeLines;
    const title = summaryTitleOf(codeLines[0] ?? "");
    if (title) body = codeLines.slice(1).join("\n").replace(/^\s*\n/, "").split("\n");
    const parts = ['<div class="cn-fence-summary">'];
    if (title) parts.push(`<p class="cn-fence-title">${inline(title)}</p>`);
    parts.push(`<pre>${escapeHtml(body.join("\n"))}</pre>`, "</div>");
    return parts.join("");
  }
  return (
    '<div class="cn-fence-input"><p class="cn-fence-label">입력</p>' +
    `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></div>`
  );
}

// 실습 단계 번호. 교안이 ①②③… 원문자로 단계를 쓴다.
const PRACTICE_STEP = /^[①-⑳]/;

export function renderNoteMarkdownToHtml(md: string, opts?: NoteMarkdownOptions): string {
  const lecture = opts?.lecture === true;
  const body = stripFrontmatter(md);
  const lines = body.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  let inPractice = false;
  const closePractice = () => {
    if (inPractice) {
      closeList();
      out.push("</section>");
      inPractice = false;
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\s+$/, "");
    let m: RegExpMatchArray | null;
    // 펜스 코드블럭: ```lang ... ``` 사이는 그대로(escape만) 담는다.
    if ((m = line.match(/^\s*```(.*)$/))) {
      closeList();
      const lang = m[1].trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // 닫는 펜스(없으면 EOF까지 코드로 취급)
      if (lecture && !lang) {
        out.push(renderBareFence(codeLines, classifyBareFence(codeLines)));
        continue;
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }
    // 표: | 로 시작·끝나는 연속 줄 묶음. 둘째 줄이 --- 구분자면 헤더로 승격.
    if (isTableLine(line)) {
      closeList();
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i].replace(/\s+$/, ""))) {
        tableLines.push(lines[i].replace(/\s+$/, ""));
        i += 1;
      }
      out.push(renderTable(tableLines));
      continue;
    }
    if (!line.trim()) {
      closeList();
      i += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      // 가로줄. 교안이 절 사이를 --- 로 나누는데, 안 다루면 화면에 "---" 가 글자로 남는다.
      // 표 구분자는 위에서 이미 걸러졌고, 프론트매터는 stripFrontmatter 가 떼어 간다.
      closePractice();
      closeList();
      out.push("<hr>");
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closePractice();
      closeList();
      const level = m[1].length;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (lecture && !inPractice && (m = line.match(/^\*\*(하면 된다!?)\s*(.*?)\*\*$/))) {
      // 실습 블록 시작. 이어지는 ①②③ 단계·펜스·팁 인용까지 한 덩어리로 감싼다.
      closeList();
      out.push('<section class="cn-practice">');
      const title = m[2] ? ` ${inline(m[2])}` : "";
      out.push(`<p class="cn-practice-head"><strong>${m[1]}</strong>${title}</p>`);
      inPractice = true;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList();
      const callout = m[1].match(/^\[!(\w+)\]\s*(.*)$/);
      if (callout) {
        const label = callout[1];
        const rest = callout[2] ? `<strong>${inline(callout[2])}</strong>` : `<strong>${label}</strong>`;
        out.push(`<blockquote class="cn-callout cn-callout-${escapeHtml(label)}">${rest}</blockquote>`);
      } else {
        out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      }
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else {
      // 실습 블록은 단계(①…)가 아닌 보통 문단이 나오면 끝난 것으로 본다.
      if (inPractice && !PRACTICE_STEP.test(line)) closePractice();
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    i += 1;
  }
  closePractice();
  closeList();
  return out.join("\n");
}
