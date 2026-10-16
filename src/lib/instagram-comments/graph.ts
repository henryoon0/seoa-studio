// Instagram Graph API 클라이언트 (Instagram Login 경로, graph.instagram.com).
// 엔드포인트는 docs/research/instagram-comments-api.md 에서 공식 문서로 확인한 것만 쓴다.
import { readStoredToken, writeStoredToken } from "./storage";
import { IG_GRAPH_BASE } from "@/lib/instagram/graph-core";

// base URL 정본은 instagram/graph-core.ts — 여기선 기존 호출처를 위해 다시 내보낸다.
export { IG_GRAPH_BASE };
const TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000; // 60일
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 만료 7일 전부터 갱신

export class IgGraphError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "IgGraphError";
  }
}

/** 모든 Graph 호출의 기본 시간 제한. 응답이 멈춘 연결이 호출부를 영원히 붙잡지 않게 한다. */
export const GRAPH_TIMEOUT_MS = 30_000;

export async function igFetch(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  const text = await res.text();
  // Graph 에러 JSON 은 error_user_msg 포함 시 700자를 넘는다 — 500자에서 자르면
  // JSON 이 깨져 호출처가 원인 문구를 못 꺼낸다 (2026-08-05 스토리 발행 실측).
  if (!res.ok) throw new IgGraphError(`Instagram API ${res.status}`, res.status, text.slice(0, 2000));
  return JSON.parse(text);
}

/**
 * 토큰 리졸브: data/instagram-comments/token.json 우선, 없으면 .env.local 시드.
 * .env.local 의 IG_ACCESS_TOKEN 이 저장된 씨앗과 다르면(새 토큰을 붙여넣은 경우)
 * token.json 을 지우지 않아도 새 토큰으로 갈아탄다.
 */
export async function resolveAccessToken(): Promise<string> {
  const stored = await readStoredToken();
  const envToken = process.env.IG_ACCESS_TOKEN;
  if (stored && (!envToken || envToken === (stored.seedToken ?? stored.accessToken))) {
    return stored.accessToken;
  }
  if (!envToken) throw new Error("IG_ACCESS_TOKEN 이 .env.local 에 없습니다");
  const now = new Date();
  await writeStoredToken({
    accessToken: envToken,
    seedToken: envToken,
    refreshedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString(),
  });
  return envToken;
}

/** 만료 7일 전이면 갱신 API 를 호출해 token.json 을 교체. 실패해도 기존 토큰으로 계속. */
export async function refreshTokenIfNeeded(nowMs = Date.now()): Promise<void> {
  const stored = await readStoredToken();
  if (!stored) return;
  const msLeft = Date.parse(stored.expiresAt) - nowMs;
  if (msLeft > REFRESH_WINDOW_MS) return;
  // 발급 24시간 이내에는 갱신 불가 (공식 제약)
  if (nowMs - Date.parse(stored.refreshedAt) < 24 * 60 * 60 * 1000) return;
  try {
    const data = (await igFetch(
      `${IG_GRAPH_BASE.replace(/\/v[\d.]+$/, "")}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(stored.accessToken)}`
    )) as { access_token: string; expires_in: number };
    const now = new Date(nowMs);
    await writeStoredToken({
      accessToken: data.access_token,
      seedToken: stored.seedToken ?? stored.accessToken,
      refreshedAt: now.toISOString(),
      expiresAt: new Date(nowMs + data.expires_in * 1000).toISOString(),
    });
  } catch {
    // 갱신 실패는 치명적이지 않음. 다음 동기화 때 재시도.
  }
}

export interface GraphMe {
  user_id: string;
  username: string;
}

export async function fetchMe(token: string, signal?: AbortSignal): Promise<GraphMe> {
  return (await igFetch(`${IG_GRAPH_BASE}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`, { signal })) as GraphMe;
}

export interface GraphMedia {
  id: string;
  caption?: string;
  permalink: string;
  timestamp: string;
  comments_count: number;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
}

export async function fetchRecentMedia(token: string, limit = 5): Promise<GraphMedia[]> {
  const data = (await igFetch(
    `${IG_GRAPH_BASE}/me/media?fields=id,caption,permalink,timestamp,comments_count,media_type&limit=${limit}&access_token=${encodeURIComponent(token)}`
  )) as { data?: GraphMedia[] };
  return data.data ?? [];
}

/**
 * 게시물의 표시용 이미지 URL 을 그때그때 조회한다. (VIDEO 는 thumbnail_url, 그 외 media_url.)
 * CDN 서명 URL 은 만료되므로 저장하지 않고 표시 직전에 받아 쓴다.
 */
export async function fetchMediaImageUrl(token: string, mediaId: string): Promise<string | null> {
  const m = (await igFetch(
    `${IG_GRAPH_BASE}/${mediaId}?fields=media_type,media_url,thumbnail_url&access_token=${encodeURIComponent(token)}`
  )) as { media_type?: string; media_url?: string; thumbnail_url?: string };
  if (m.media_type === "VIDEO") return m.thumbnail_url ?? m.media_url ?? null;
  return m.media_url ?? m.thumbnail_url ?? null;
}

export interface GraphFrom {
  id: string;
  username?: string;
}

export interface GraphComment {
  id: string;
  text?: string;
  username?: string;
  /** 작성자 신원. Instagram Login 경로에서 username 은 타인엔 null 이지만 from{id,username} 은 항상 온다. */
  from?: GraphFrom;
  timestamp: string;
  parent_id?: string;
  replies?: {
    data?: { id: string; text?: string; username?: string; from?: GraphFrom; timestamp: string }[];
  };
}

/** 한 게시물에서 읽을 댓글 페이지 상한 (50개 × 100 = 5,000개). 끝없는 다음 페이지 방어. */
export const COMMENT_PAGE_CAP = 100;

/**
 * 게시물 1개의 댓글 전체 (50개 단위 페이지네이션 추적). 페이지마다 igFetch 시간 제한이 걸린다.
 * 상한에 걸려 끝까지 못 읽으면 complete=false — 호출부가 성공이 아니라 미완료로 기록한다.
 */
export async function fetchComments(
  token: string,
  mediaId: string
): Promise<{ comments: GraphComment[]; complete: boolean }> {
  const fields =
    "id,text,username,from{id,username},timestamp,parent_id,replies{id,text,username,from{id,username},timestamp}";
  let url: string | undefined = `${IG_GRAPH_BASE}/${mediaId}/comments?fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(token)}`;
  const comments: GraphComment[] = [];
  for (let page = 0; url && page < COMMENT_PAGE_CAP; page += 1) {
    const res = (await igFetch(url)) as { data?: GraphComment[]; paging?: { next?: string } };
    comments.push(...(res.data ?? []));
    url = res.paging?.next;
  }
  return { comments, complete: !url };
}

/** 댓글에 공개 답글 1건 발송. 응답은 새 답글 댓글의 id. signal 로 하드 타임아웃을 건다. */
export async function postReply(
  token: string,
  commentId: string,
  message: string,
  signal?: AbortSignal
): Promise<{ id: string }> {
  const url = `${IG_GRAPH_BASE}/${commentId}/replies`;
  return (await igFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message, access_token: token }).toString(),
    signal,
  })) as { id: string };
}

/** 댓글의 답글 목록 (재발송 전 확인용 — 결과 불명이던 발송이 실제로 달렸는지 본다). */
export interface GraphReply {
  id: string;
  text?: string;
  from?: GraphFrom;
  username?: string;
  timestamp?: string;
}

export async function fetchReplies(token: string, commentId: string, signal?: AbortSignal): Promise<GraphReply[]> {
  const fields = "id,text,username,from{id,username},timestamp";
  let url: string | undefined = `${IG_GRAPH_BASE}/${commentId}/replies?fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(token)}`;
  const all: GraphReply[] = [];
  let guard = 0;
  while (url && guard < 10) {
    const page = (await igFetch(url, { signal })) as { data?: typeof all; paging?: { next?: string } };
    all.push(...(page.data ?? []));
    url = page.paging?.next;
    guard += 1;
  }
  // 끝까지 못 읽었으면 "없음"이라고 답하면 안 된다 — 확인 실패로 올려 재발송을 막는다.
  if (url) throw new Error(`답글이 ${all.length}개를 넘어 끝까지 확인하지 못했어요`);
  return all;
}

/**
 * 발송 실패가 "확실히 안 달림"인지 판정. 인스타가 4xx 로 거절한 경우만 확실하다.
 * 시간 초과·연결 끊김·5xx 는 요청이 이미 처리됐을 수 있다(결과 불명).
 */
export function isDefiniteFailure(error: unknown): boolean {
  return error instanceof IgGraphError && error.status >= 400 && error.status < 500;
}
