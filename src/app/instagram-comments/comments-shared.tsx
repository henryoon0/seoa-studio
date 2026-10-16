"use client";
import { Icon } from "@/components/icon";

// 댓글 작업대 공용 조각 — 타입·아바타·시간·접기. comments-client 와 떼어 낸 목록·기록·한 장씩 화면이 같이 쓴다.

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CommentIntent } from "@/lib/instagram-comments/intent";

export interface HistoryItem {
  id: string;
  mediaId: string;
  text: string;
  timestamp: string;
  myReplyText?: string;
  repliedAt?: string;
}

export interface PersonHistory {
  interactionCount: number;
  items: HistoryItem[];
  summary: string;
}

/** 스레드 답글일 때, 그 대화의 뿌리 댓글 + 내가 단 답글 */
export interface ThreadContext {
  username: string;
  text: string;
  timestamp: string;
  myReplyText?: string;
}

export interface Comment {
  id: string;
  mediaId: string;
  username: string;
  text: string;
  timestamp: string;
  parentId?: string;
  draft?: string;
  /** AI 후보 3개 (짧게 · 따뜻하게 · 안내 포함) */
  draftOptions?: DraftOption[];
  profileUrl?: string | null;
  myReplyText?: string;
  repliedAt?: string;
  interactionCount: number;
  totalComments: number;
  history: PersonHistory;
  thread?: ThreadContext | null;
}

export interface MediaInfo {
  id: string;
  captionFirstLine: string;
  permalink: string;
  timestamp: string;
  commentsCount: number;
  mediaType?: string;
}

export interface DraftJob {
  id: string;
  scope: string;
  commentIds: string[];
  done: string[];
  failed: { commentId: string; error: string }[];
  status: "running" | "done" | "stopped";
}

export interface QueueItem {
  commentId: string;
  message: string;
  status: "queued" | "sending" | "sent" | "failed" | "unknown";
  error?: string;
  /** 인스타에 요청한 횟수. 1 이상이면 문구가 고정되고 회수할 수 없다. */
  attempts?: number;
}

export interface QueueView {
  items: QueueItem[];
  status: "idle" | "running" | "stopped" | "done";
  stopReason?: string;
  /** 대기줄이 마지막으로 바뀐 시각 — 끝난 결과를 언제까지 보여줄지 판단한다 */
  updatedAt?: string;
  counts: { queued: number; sending: number; sent: number; failed: number; unknown: number };
}

// 작성자 계정 조회 (#64, business_discovery) — 프로 계정만 found:true
export interface DiscoveryEntry {
  username: string;
  found: boolean;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
  recentMedia?: {
    caption?: string;
    likeCount?: number;
    commentsCount?: number;
    permalink?: string;
    timestamp?: string;
  }[];
  error?: string;
}

export function postImageUrl(mediaId: string) {
  return `/api/instagram/comments/post-image?mediaId=${encodeURIComponent(mediaId)}`;
}

export interface ViewData {
  pending: Comment[];
  replied: Comment[];
  skipped: Comment[];
  /** 내 게시물에 달렸지만 나에게 온 말은 아닌 대댓글 (댓글끼리 주고받는 말) */
  others: Comment[];
  media: Record<string, MediaInfo>;
  repliedToday: number;
  sync: { lastSyncAt?: string; lastError?: string; incomplete?: string };
}

export type Tab = "pending" | "replied" | "skipped" | "others";

export interface DraftOption {
  tone: "short" | "warm" | "guide";
  text: string;
}

export const TONE_LABEL: Record<DraftOption["tone"], string> = {
  short: "짧게",
  warm: "따뜻하게",
  guide: "안내 포함",
};

/** 질문 먼저 묶음 (09-27 픽). 이모지만은 기본으로 접는다. */
export const INTENT_GROUPS: { key: CommentIntent; label: string; dot: string; folded: boolean }[] = [
  { key: "question", label: "질문·문의", dot: "bg-amber-500", folded: false },
  { key: "thanks", label: "감사 인사", dot: "bg-emerald-500", folded: false },
  { key: "emoji", label: "이모지만", dot: "bg-neutral-300", folded: true },
];

const AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-indigo-100 text-indigo-700",
];

function avatarColor(username: string) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({
  username,
  size = "md",
  photoUrl,
}: {
  username: string;
  size?: "sm" | "lg" | "md";
  photoUrl?: string;
}) {
  const cls = size === "lg" ? "size-10 text-sm" : size === "sm" ? "size-7 text-[11px]" : "size-8 text-xs";
  const [broken, setBroken] = useState(false);
  if (photoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={username}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full object-cover ring-1 ring-neutral-950/5 ${cls}`}
        loading="lazy"
      />
    );
  }
  const label = username.replace(/^\(|\)$/g, "").slice(0, 1).toUpperCase() || "?";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${avatarColor(username)} ${cls}`}>
      {label}
    </span>
  );
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const min = Math.floor(ms / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/**
 * 접힌 내용을 높이 스프링으로 편다. 상시 노출이던 칸(맥락·지시)을 접어두는 데 쓴다.
 * 튐 없이(bounce 0) 열리고, prefers-reduced-motion 이면 페이드만.
 */
export function Disclosure({ open, children }: { open: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Handle({ username, profileUrl, className = "" }: { username: string; profileUrl?: string | null; className?: string }) {
  if (!profileUrl) return <span className={`font-medium text-neutral-500 ${className}`}>{username}</span>;
  return (
    <a
      href={profileUrl}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-0.5 font-medium text-neutral-900 hover:text-emerald-700 ${className}`}
    >
      @{username}
      <Icon name="external" className="size-3 text-neutral-300" />
    </a>
  );
}
