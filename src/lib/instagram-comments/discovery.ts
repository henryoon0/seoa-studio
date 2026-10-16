// 작성자 계정 조회 (#64) — business_discovery (Facebook Login 경로, AICC Discovery 앱).
// 상대가 프로 계정(비즈니스·크리에이터)일 때만 프로필 사진·팔로워·최근 게시물이 내려온다.
// 개인 계정은 조회 불가 → found:false 로 캐시해 재조회 낭비를 막는다.
// 토큰: .env.local FB_DISCOVERY_ACCESS_TOKEN (60일, 만료 시 그래프 탐색기에서 재발급).
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { instagramCommentsDir } from "./storage";
import { dict, own } from "./model";
import { FB_GRAPH_BASE } from "@/lib/instagram/graph-core";

// 프로 계정 정보는 자주 안 변한다. 3일 캐시.
const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export interface DiscoveryMedia {
  caption?: string;
  likeCount?: number;
  commentsCount?: number;
  permalink?: string;
  timestamp?: string;
}

export interface DiscoveryEntry {
  username: string;
  fetchedAt: string;
  /** 프로 계정으로 조회 성공 여부. false = 개인 계정 등 조회 불가. */
  found: boolean;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
  recentMedia?: DiscoveryMedia[];
  /** 토큰 만료 같은 시스템 오류 (found 와 구분 — 이건 캐시하지 않는다) */
  error?: string;
}

export function discoveryCachePath(): string {
  return path.join(instagramCommentsDir(), "discovery.json");
}

async function readCache(): Promise<Record<string, DiscoveryEntry>> {
  try {
    const raw = await readFile(discoveryCachePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return dict(parsed && typeof parsed === "object" ? (parsed as Record<string, DiscoveryEntry>) : undefined);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return dict();
    throw error;
  }
}

async function writeCache(cache: Record<string, DiscoveryEntry>): Promise<void> {
  await mkdir(path.dirname(discoveryCachePath()), { recursive: true });
  await writeFile(discoveryCachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function isFresh(entry: DiscoveryEntry | undefined, nowMs: number): entry is DiscoveryEntry {
  if (!entry || entry.error) return false;
  return nowMs - Date.parse(entry.fetchedAt) < CACHE_TTL_MS;
}

interface RawDiscovery {
  business_discovery?: {
    username?: string;
    followers_count?: number;
    media_count?: number;
    profile_picture_url?: string;
    media?: {
      data?: {
        caption?: string;
        like_count?: number;
        comments_count?: number;
        permalink?: string;
        timestamp?: string;
      }[];
    };
  };
  error?: { message?: string; code?: number; error_subcode?: number };
}

/**
 * 작성자 1명 조회 (캐시 우선). username 은 댓글의 from.username.
 * 반환은 항상 DiscoveryEntry — found:false(개인 계정)와 error(토큰 등 시스템 문제)를 구분.
 */
export async function discoverPerson(username: string, nowMs = Date.now()): Promise<DiscoveryEntry> {
  const clean = username.replace(/[^A-Za-z0-9._]/g, "");
  if (!clean) return { username, fetchedAt: new Date(nowMs).toISOString(), found: false };

  const cache = await readCache();
  const cached = own(cache, clean);
  if (isFresh(cached, nowMs)) return cached;

  const token = process.env.FB_DISCOVERY_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId) {
    return {
      username: clean,
      fetchedAt: new Date(nowMs).toISOString(),
      found: false,
      error: "FB_DISCOVERY_ACCESS_TOKEN 또는 IG_USER_ID 가 .env.local 에 없어요",
    };
  }

  const fields = `business_discovery.username(${clean}){username,followers_count,media_count,profile_picture_url,media.limit(3){caption,like_count,comments_count,permalink,timestamp}}`;
  const url = `${FB_GRAPH_BASE}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;

  let entry: DiscoveryEntry;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = (await res.json()) as RawDiscovery;
    if (body.business_discovery) {
      const bd = body.business_discovery;
      entry = {
        username: clean,
        fetchedAt: new Date(nowMs).toISOString(),
        found: true,
        profilePictureUrl: bd.profile_picture_url,
        followersCount: bd.followers_count,
        mediaCount: bd.media_count,
        recentMedia: (bd.media?.data ?? []).map((m) => ({
          // 첫 줄만 자르면 이모지 한 줄짜리 캡션에서 맥락이 통째로 날아간다 —
          // 줄바꿈을 공백으로 접고 본문을 넉넉히 가져온다 (henry 피드백 07-12)
          caption: m.caption ? m.caption.replace(/\s+/g, " ").trim().slice(0, 180) : undefined,
          likeCount: m.like_count,
          commentsCount: m.comments_count,
          permalink: m.permalink,
          timestamp: m.timestamp,
        })),
      };
    } else if (body.error && isTokenError(body.error)) {
      // 토큰 만료/무효 — 캐시하지 않고 에러로 보고 (재발급 안내가 UI 에 뜨게)
      return {
        username: clean,
        fetchedAt: new Date(nowMs).toISOString(),
        found: false,
        error: `조회 토큰 문제: ${body.error.message ?? "알 수 없음"}. 그래프 탐색기에서 토큰을 재발급해 .env.local 을 갱신해주세요.`,
      };
    } else {
      // 개인 계정 등 조회 불가 — found:false 로 캐시 (재조회 낭비 방지)
      entry = { username: clean, fetchedAt: new Date(nowMs).toISOString(), found: false };
    }
  } catch (error) {
    return {
      username: clean,
      fetchedAt: new Date(nowMs).toISOString(),
      found: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const fresh = await readCache();
  fresh[clean] = entry;
  await writeCache(fresh);
  return entry;
}

/** 코드 190 = OAuth 토큰 문제 (만료·무효). */
function isTokenError(error: { code?: number }): boolean {
  return error.code === 190;
}
