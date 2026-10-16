/**
 * 노션 페이지 본문 읽기 — 내부 통합 토큰(NOTION_TOKEN)으로 노션 API 를 부른다.
 * "웹에 게시"하지 않은 페이지도, 그 페이지에 통합이 연결돼 있으면 읽힌다.
 * 블록 트리를 평평한 마크다운 비슷한 텍스트로 만든다(표·토글·하위 목록 포함).
 */

const NOTION_VERSION = "2022-06-28";
const MAX_BLOCKS = 1_500;
const MAX_DEPTH = 6;

export interface NotionPageText {
  title: string;
  content: string;
}

export function notionToken(): string | undefined {
  const t = process.env.NOTION_TOKEN?.trim();
  return t || undefined;
}

export function isNotionUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === "notion.so" ||
      h.endsWith(".notion.so") ||
      h === "notion.com" ||
      h.endsWith(".notion.com") ||
      h.endsWith(".notion.site")
    );
  } catch {
    return false;
  }
}

/** 노션 URL 끝의 32자리 hex 를 페이지 id 로 뽑는다(하이픈 형식으로). */
export function extractNotionPageId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const fromQuery = u.searchParams.get("p");
  const candidates = [fromQuery ?? "", ...u.pathname.split("/")];
  for (const c of candidates.reverse()) {
    const m = c.replace(/-/g, "").match(/([0-9a-f]{32})$/i);
    if (m) {
      const id = m[1].toLowerCase();
      return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
    }
  }
  return null;
}

type RichText = { plain_text?: string };
type Block = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

export function richTextToPlain(rt: unknown): string {
  if (!Array.isArray(rt)) return "";
  return (rt as RichText[]).map((r) => r.plain_text ?? "").join("");
}

/** 본문 텍스트 앞에 붙는 마크다운 기호. 들여쓰기가 필요한 목록류는 indent 를 받는다. */
const LINE_PREFIX: Record<string, (indent: string) => string> = {
  heading_1: () => "# ",
  heading_2: () => "## ",
  heading_3: () => "### ",
  bulleted_list_item: (i) => `${i}- `,
  toggle: (i) => `${i}- `,
  numbered_list_item: (i) => `${i}1. `,
  quote: () => "> ",
  callout: () => "> ",
};

function tableRowLine(body: Record<string, unknown> | undefined): string | null {
  const cells = Array.isArray(body?.cells)
    ? (body!.cells as unknown[]).map(richTextToPlain)
    : [];
  return cells.length ? `| ${cells.join(" | ")} |` : null;
}

/** 접두어만 붙이면 되는 블록이 아닌 특수 블록들. 해당 없으면 undefined. */
const SPECIAL_LINE: Record<
  string,
  (body: Record<string, unknown> | undefined, text: string, indent: string) => string | null
> = {
  to_do: (body, text, indent) => `${indent}- [${body?.checked ? "x" : " "}] ${text}`,
  code: (_body, text) => (text ? `\`\`\`\n${text}\n\`\`\`` : null),
  table_row: (body) => tableRowLine(body),
  child_page: (body, _text, indent) => `${indent}- [하위 페이지] ${String(body?.title ?? "")}`,
  divider: () => "---",
};

/** 블록 1개를 한 줄 텍스트로. 렌더할 게 없으면 null. */
export function blockToLine(block: Block, depth: number): string | null {
  const body = block[block.type] as Record<string, unknown> | undefined;
  const text = richTextToPlain(body?.rich_text);
  const indent = "  ".repeat(depth);
  const prefix = LINE_PREFIX[block.type];
  if (prefix) return `${prefix(indent)}${text}`;
  const special = SPECIAL_LINE[block.type];
  if (special) return special(body, text, indent);
  return text || null;
}

async function notionGet(path: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      res.status === 404
        ? "페이지를 찾을 수 없습니다. 노션 페이지 ··· → 연결에서 통합을 추가했는지 확인해 주세요."
        : res.status === 401
          ? "NOTION_TOKEN 이 올바르지 않습니다."
          : `노션 API ${res.status}: ${body.message ?? ""}`
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

async function listChildren(blockId: string, token: string): Promise<Block[]> {
  const out: Block[] = [];
  let cursor: string | undefined;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const page = await notionGet(`/blocks/${blockId}/children${q}`, token);
    out.push(...((page.results as Block[]) ?? []));
    cursor = page.has_more ? (page.next_cursor as string) : undefined;
  } while (cursor && out.length < MAX_BLOCKS);
  return out;
}

async function walk(
  blockId: string,
  token: string,
  depth: number,
  lines: string[],
  budget: { left: number }
): Promise<void> {
  if (depth > MAX_DEPTH || budget.left <= 0) return;
  const children = await listChildren(blockId, token);
  for (const block of children) {
    if (budget.left-- <= 0) return;
    const line = blockToLine(block, depth);
    if (line) lines.push(line);
    // 하위 페이지 본문까지는 따라가지 않는다(자료가 폭발하지 않게). 토글·목록 자식만.
    if (block.has_children && block.type !== "child_page" && block.type !== "child_database") {
      await walk(block.id, token, depth + 1, lines, budget);
    }
  }
}

function pageTitle(page: Record<string, unknown>): string {
  const props = (page.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const p of Object.values(props)) {
    if (p.type === "title") return richTextToPlain(p.title);
  }
  return "";
}

/** 통합이 연결된 노션 페이지를 텍스트로 읽는다. 실패는 throw(호출부가 error 로 저장). */
export async function fetchNotionPageText(
  url: string,
  token = notionToken()
): Promise<NotionPageText> {
  if (!token) throw new Error("NOTION_TOKEN 이 설정되지 않았습니다.");
  const id = extractNotionPageId(url);
  if (!id) throw new Error("노션 링크에서 페이지 id 를 찾지 못했습니다.");
  const page = await notionGet(`/pages/${id}`, token);
  const lines: string[] = [];
  await walk(id, token, 0, lines, { left: MAX_BLOCKS });
  return { title: pageTitle(page), content: lines.join("\n").trim() };
}
