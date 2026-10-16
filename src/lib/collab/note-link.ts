/**
 * 데일리노트 ↔ 협업 태스크 연결 꼬리표 (plans/collab-todo-link.md).
 *
 * A linked todo line ends with an Obsidian block id: `- [ ] 제목 ^clb7f2a1`.
 * The token rides inside the line's *text*, so carryover (which copies the
 * text into a new day's note) moves the link for free. Everything that
 * displays, edits, or asserts on todo text must go through splitNoteRef —
 * comparing raw text against clean text is the #1 way this feature breaks.
 */

const REF_BODY = /^clb[a-z0-9]{6}$/;
const TRAILING_REF = /\s+\^(clb[a-z0-9]{6})\s*$/;

export function isNoteRef(value: string): boolean {
  return REF_BODY.test(value);
}

/** Strip a trailing link token. Returns the display text and the ref (sans ^). */
export function splitNoteRef(text: string): { clean: string; ref?: string } {
  const m = text.match(TRAILING_REF);
  if (!m) return { clean: text };
  return { clean: text.slice(0, m.index).trimEnd(), ref: m[1] };
}

/** Attach (or replace) the link token at the end of a display text. */
export function attachNoteRef(text: string, ref: string): string {
  return `${splitNoteRef(text).clean} ^${ref}`;
}

/** Same todo, ignoring the token — for expectedText assertions. */
export function sameTodoText(a: string, b: string): boolean {
  return splitNoteRef(a).clean === splitNoteRef(b).clean;
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** New 6-char ref body ("clbxxxxxx"). Pass rand for deterministic tests. */
export function makeNoteRef(rand: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < 6; i += 1) {
    body += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length];
  }
  return `clb${body}`;
}
