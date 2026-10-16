import { extractArticle } from "@/lib/article-extract";
import {
  fetchNotionPageText,
  isNotionUrl,
  notionToken,
} from "@/lib/notion-page";
import { getMeeting, updateMeeting } from "./store";
import type { Meeting, MeetingContextSource } from "./types";

// 회의록 참고 자료(노션·웹 링크) — 추출·저장·프롬프트 블록 조립을 한 곳에 모은다.

/** 자료 1건당 본문 상한. 용어집·회의 안건 문서면 이 안에 충분히 들어온다. */
export const CONTEXT_SOURCE_CHAR_CAP = 20_000;
/** 회의 1건당 자료 개수 상한. */
export const CONTEXT_SOURCE_MAX = 5;

export type AddContextSourceOutcome =
  | { kind: "meeting-not-found" }
  | { kind: "invalid-url" }
  | { kind: "limit-reached"; max: number }
  | { kind: "success"; source: MeetingContextSource; meeting: Meeting };

const LOCAL_NAMES = ["localhost"];
const LOCAL_SUFFIXES = [".localhost", ".local"];

function isLocalName(h: string): boolean {
  return LOCAL_NAMES.includes(h) || LOCAL_SUFFIXES.some((s) => h.endsWith(s));
}

function isPrivateIpv6(h: string): boolean {
  return h === "::1" || h === "::" || /^(fc|fd|fe80)/.test(h);
}

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

/** IPv4 매핑 IPv6(::ffff:7f00:1 / ::ffff:127.0.0.1)를 안쪽 IPv4 문자열로. 아니면 null. */
function unmapIpv6(h: string): string | null {
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  const dotted = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return dotted ? dotted[1] : null;
}

/** 숫자로만 된 호스트(127.1, 2130706433, 0x7f000001) — 주소 위장으로 보고 거부. */
function isNumericHost(h: string): boolean {
  return /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(h);
}

/**
 * 로컬·사설망 주소는 거부한다. 링크를 서버가 대신 읽는 기능이라, 내부 주소를
 * 넣어 대시보드 자신이나 같은 망의 다른 서비스를 열게 만드는 통로(SSRF)를 막는다.
 * 단일 사용자 로컬 앱이라 DNS 재바인딩까지는 막지 않는다(공개 문서 링크만 필요).
 */
export function isLocalOrPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLocalName(h) || isPrivateIpv6(h)) return true;
  const unmapped = unmapIpv6(h);
  if (unmapped) return isLocalOrPrivateHost(unmapped);
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m ? isPrivateIpv4(Number(m[1]), Number(m[2])) : isNumericHost(h);
}

export function normalizeContextUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (isLocalOrPrivateHost(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last).replace(/-[0-9a-f]{32}$/i, "") : u.hostname;
  } catch {
    return url;
  }
}

function failed(url: string, title: string, fetchedAt: string, error: string): MeetingContextSource {
  return { url, title, content: "", fetchedAt, error };
}

async function fetchViaNotion(url: string, fetchedAt: string): Promise<MeetingContextSource> {
  try {
    const page = await fetchNotionPageText(url);
    const content = page.content.slice(0, CONTEXT_SOURCE_CHAR_CAP);
    const title = page.title || fallbackTitle(url);
    if (!content) return failed(url, title, fetchedAt, "노션 페이지가 비어 있습니다.");
    return { url, title, content, fetchedAt, via: "notion-api" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "노션 읽기 실패";
    return failed(url, fallbackTitle(url), fetchedAt, message);
  }
}

async function fetchViaWeb(url: string, fetchedAt: string): Promise<MeetingContextSource> {
  const article = await extractArticle(url);
  const content = article.content.trim().slice(0, CONTEXT_SOURCE_CHAR_CAP);
  const title = article.title.trim() || fallbackTitle(url);
  if (content) return { url, title, content, fetchedAt, via: "web" };
  const hint = isNotionUrl(url)
    ? " NOTION_TOKEN 을 설정하고 페이지에 통합을 연결하거나, '웹에 게시'를 켜 주세요."
    : "";
  return failed(url, title, fetchedAt, `본문을 읽지 못했습니다.${hint}`);
}

/**
 * 링크를 읽어 본문을 추출한다. 실패해도 throw 하지 않고 error 필드로 돌려준다.
 * 노션 링크 + 통합 토큰이면 API 로(웹에 게시 안 한 페이지도 됨), 아니면 웹 추출.
 */
export async function fetchContextSource(
  url: string,
  fetchedAt = new Date().toISOString()
): Promise<MeetingContextSource> {
  return isNotionUrl(url) && notionToken()
    ? fetchViaNotion(url, fetchedAt)
    : fetchViaWeb(url, fetchedAt);
}

export async function addMeetingContextSource(
  meetingId: string,
  rawUrl: unknown
): Promise<AddContextSourceOutcome> {
  const url = normalizeContextUrl(rawUrl);
  if (!url) return { kind: "invalid-url" };
  const meeting = await getMeeting(meetingId);
  if (!meeting) return { kind: "meeting-not-found" };
  const existing = (meeting.contextSources ?? []).filter((s) => s.url !== url);
  if (existing.length >= CONTEXT_SOURCE_MAX) {
    return { kind: "limit-reached", max: CONTEXT_SOURCE_MAX };
  }
  const source = await fetchContextSource(url);
  const updated = await updateMeeting(meetingId, {
    contextSources: [...existing, source],
  });
  if (!updated) return { kind: "meeting-not-found" };
  return { kind: "success", source, meeting: updated };
}

export async function removeMeetingContextSource(
  meetingId: string,
  rawUrl: unknown
): Promise<Meeting | null> {
  const url = normalizeContextUrl(rawUrl);
  const meeting = await getMeeting(meetingId);
  if (!meeting || !url) return meeting;
  const remaining = (meeting.contextSources ?? []).filter((s) => s.url !== url);
  return updateMeeting(meetingId, {
    contextSources: remaining.length ? remaining : undefined,
  });
}

/**
 * 프롬프트에 넣을 참고 자료 블록. 본문이 있는 자료만 포함하며, 하나도 없으면
 * undefined 를 돌려 프롬프트가 참고 자료 섹션 자체를 생략하게 한다.
 */
export function buildContextText(
  sources: readonly MeetingContextSource[] | undefined
): string | undefined {
  const usable = (sources ?? []).filter((s) => s.content && !s.error);
  if (!usable.length) return undefined;
  return usable
    .map(
      (s, i) =>
        `[참고 자료 ${i + 1}] ${s.title}\n출처: ${s.url}\n${s.content}`
    )
    .join("\n\n");
}
