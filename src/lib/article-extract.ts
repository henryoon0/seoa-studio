/**
 * Article body extraction with an Obsidian Clipper-style strategy chain:
 *
 * 1. Direct fetch + Defuddle (the engine behind Obsidian Web Clipper) —
 *    strips chrome/nav/footers and returns the main content as markdown.
 * 2. Jina Reader (r.jina.ai) — renders JS-heavy pages and many paywalled
 *    newsletters (Every, etc.) server-side and returns clean markdown.
 * 3. Raw HTML tag-strip as a last resort.
 */

export interface ExtractedArticle {
  title: string;
  author?: string;
  /** main content, markdown or plain text */
  content: string;
  via: "defuddle" | "jina" | "raw" | "none";
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Below this many characters the extraction is considered too thin to trust. */
const MIN_GOOD_CHARS = 500;

type Fetcher = typeof fetch;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function rawBodyText(html: string): string {
  const article = html.match(/<article[\s\S]*?<\/article>/i);
  if (article) return stripTags(article[0]);
  const main = html.match(/<main[\s\S]*?<\/main>/i);
  if (main) return stripTags(main[0]);
  const body = html.match(/<body[\s\S]*?<\/body>/i);
  if (body) return stripTags(body[0]);
  return stripTags(html);
}

async function runDefuddle(
  html: string,
  url: string
): Promise<{ title: string; author?: string; content: string } | null> {
  try {
    const { Defuddle } = await import("defuddle/node");
    const result = await Defuddle(html, url, { markdown: true });
    const content = (result.content ?? "").trim();
    if (!content) return null;
    return {
      title: (result.title ?? "").trim(),
      author: result.author?.trim() || undefined,
      content,
    };
  } catch (e) {
    console.warn("[article-extract] defuddle failed:", e);
    return null;
  }
}

/** Parse Jina Reader's default markdown envelope. */
export function parseJinaResponse(text: string): {
  title: string;
  content: string;
} {
  const titleMatch = text.match(/^Title:\s*(.+)$/m);
  const marker = text.indexOf("Markdown Content:");
  const content =
    marker >= 0 ? text.slice(marker + "Markdown Content:".length).trim() : text.trim();
  return { title: titleMatch?.[1]?.trim() ?? "", content };
}

async function runJina(
  url: string,
  fetcher: Fetcher
): Promise<{ title: string; content: string } | null> {
  try {
    const res = await fetcher(`https://r.jina.ai/${url}`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const parsed = parseJinaResponse(text);
    return parsed.content ? parsed : null;
  } catch (e) {
    console.warn("[article-extract] jina reader failed:", e);
    return null;
  }
}

async function fetchHtml(url: string, fetcher: Fetcher): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Extract the main content of an article URL. Never throws — returns
 * `via: "none"` with empty content when every strategy failed.
 */
export async function extractArticle(
  url: string,
  opts?: { html?: string; fetcher?: Fetcher }
): Promise<ExtractedArticle> {
  const fetcher = opts?.fetcher ?? fetch;
  const html = opts?.html ?? (await fetchHtml(url, fetcher));

  let best: ExtractedArticle = { title: "", content: "", via: "none" };

  if (html) {
    const d = await runDefuddle(html, url);
    if (d) {
      best = { title: d.title, author: d.author, content: d.content, via: "defuddle" };
      if (d.content.length >= MIN_GOOD_CHARS) return best;
    }
  }

  // Direct extraction failed or came back thin (paywall teaser, JS-rendered
  // shell, bot block) — let Jina Reader render it.
  const j = await runJina(url, fetcher);
  if (j && j.content.length > best.content.length) {
    best = { title: best.title || j.title, author: best.author, content: j.content, via: "jina" };
  }
  if (best.content.length >= MIN_GOOD_CHARS) return best;

  if (html) {
    const raw = rawBodyText(html);
    if (raw.length > best.content.length) {
      best = { title: best.title, author: best.author, content: raw, via: "raw" };
    }
  }

  return best;
}

export const __testing = { rawBodyText, stripTags };
