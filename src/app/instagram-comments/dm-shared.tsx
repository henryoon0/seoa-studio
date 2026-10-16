// DM 작업대 공용 조각: 타입·아바타·목적 칩·말풍선 미디어. dm-client, dm-lanes, dm-thread 가 같이 쓴다.
// "use client" 없음: 클라이언트 컴포넌트에서만 import 된다.

import { useEffect, useState } from "react";
import type { PickerForm } from "./dm-form-picker";

/** 목적 분류 (서버 DmPurpose 와 같은 키) */
export type Purpose = "inquiry" | "collab" | "student" | "thanks" | "other";

const PURPOSE_CHIPS: Record<Purpose, { label: string; className: string }> = {
  inquiry: { label: "강의 문의", className: "bg-emerald-100 text-emerald-800" },
  collab: { label: "협업 제안", className: "bg-sky-100 text-sky-700" },
  student: { label: "수강생·질문", className: "bg-indigo-100 text-indigo-700" },
  thanks: { label: "감사·응원", className: "bg-neutral-100 text-neutral-500" },
  other: { label: "기타", className: "bg-neutral-100 text-neutral-500" },
};

export function PurposeChip({ purpose }: { purpose: Purpose | null }) {
  if (!purpose) return null;
  const chip = PURPOSE_CHIPS[purpose];
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${chip.className}`}>
      {chip.label}
    </span>
  );
}

/** 24시간 창 마감까지 남은 시간. 6시간 미만이면 급함(amber)으로 표시한다. */
export function windowLeft(closesAt: string | null): { label: string; urgent: boolean } | null {
  if (!closesAt) return null;
  const ms = Date.parse(closesAt) - Date.now();
  if (ms <= 0) return null;
  const hr = Math.floor(ms / 3_600_000);
  const min = Math.floor((ms % 3_600_000) / 60_000);
  return { label: hr >= 1 ? `창 ${hr}시간 남음` : `창 ${min}분 남음`, urgent: ms < 6 * 3_600_000 };
}

/** 스토리는 올라온 지 24시간이면 사라진다 — 남은 시간을 사람 말로 */
export function storyExpiry(createdTime: string, nowMs = Date.now()): string {
  const left = 24 * 3_600_000 - (nowMs - Date.parse(createdTime));
  if (!Number.isFinite(left) || left <= 0) return "곧 사라져요";
  const hr = Math.floor(left / 3_600_000);
  if (hr >= 1) return `${hr}시간 뒤 사라져요`;
  return `${Math.max(1, Math.floor(left / 60_000))}분 뒤 사라져요`;
}

/** 답례 대기 한 건 — /api/instagram/dm/regram/batch 의 items 모양 */
export interface RegramWaiting {
  conversationId: string;
  messageId: string;
  peerUsername: string;
  createdTime: string;
  storyLink: string;
  status: string;
  /** 원장에 저장된 문구 — 작업대가 이걸 이어받아 다시 만들지 않는다 (2026-08-31) */
  phrase?: string;
}

export interface DmMessage {
  id: string;
  fromMe: boolean;
  text: string;
  createdTime: string;
  /** 스토리 언급/답장 — link 는 스토리 만료(24시간) 후 빈 문자열 */
  story?: { kind: "mention" | "reply_to"; link: string };
  attachments?: { imageUrl?: string; videoUrl?: string; fileUrl?: string }[];
}

function storyLabel(story: NonNullable<DmMessage["story"]>, fromMe: boolean): string {
  if (story.kind === "mention") return fromMe ? "스토리에서 상대를 언급했어요" : "스토리에서 나를 언급했어요";
  return fromMe ? "상대 스토리에 답장했어요" : "내 스토리에 답장했어요";
}

function attachmentLabel(attachments: NonNullable<DmMessage["attachments"]>): string | null {
  if (attachments.some((a) => a.imageUrl)) return "사진을 보냈어요";
  if (attachments.some((a) => a.videoUrl)) return "영상을 보냈어요";
  return attachments.length ? "파일을 보냈어요" : null;
}

/** 서버 dmMessageKindLabel 과 같은 문구: 텍스트 없는 메시지의 정체 표시 */
export function messageKindLabel(m: DmMessage): string | null {
  if (m.story) return storyLabel(m.story, m.fromMe);
  return attachmentLabel(m.attachments ?? []);
}

/** 만료된 CDN 링크는 로드에 실패한다 — 실패하면 이미지를 통째로 감춘다. 클릭하면 확대(라이트박스). */
export function MediaImage({ src, alt, onZoom }: { src: string; alt: string; onZoom?: (src: string) => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 인스타 CDN 서명 URL 은 next/image 최적화 불가
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      onClick={() => onZoom?.(src)}
      className={`mt-1.5 max-h-60 w-auto rounded-xl ring-1 ring-neutral-950/5 ${onZoom ? "cursor-zoom-in" : ""}`}
    />
  );
}

/** 이미지 확대 보기 — 아무 데나 클릭하거나 Esc 로 닫는다 */
export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-neutral-950/80 p-6"
      role="dialog"
      aria-label="이미지 확대 보기"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="확대 이미지" className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain" />
    </div>
  );
}

export interface Conversation {
  id: string;
  peerUsername: string;
  profileUrl: string | null;
  updatedTime: string;
  lastText: string;
  messages: DmMessage[];
  canReply: boolean;
  draft: string;
  purpose: Purpose | null;
  windowClosesAt: string | null;
  /** 두 칸 나누기: reply = 글로 답할 것, done = 정리할 것 (마무리 인사·스토리 언급·이모지) */
  triage?: "reply" | "done";
  triageReason?: string;
  /** 이 상대가 내 게시물 댓글로도 교류하던 사람이면 그 이력 (사람 카드) */
  commentHistory: {
    summary: string;
    items: { id: string; text: string; timestamp: string; myReplyText: string | null }[];
  } | null;
}

export type AiccForm = PickerForm;

/** 작성자 계정 조회 (댓글 작업대와 같은 API, 3일 서버 캐시) — 프로 계정만 사진·팔로워 */
export interface DiscoveryEntry {
  username: string;
  found: boolean;
  profilePictureUrl?: string;
  followersCount?: number;
}

export interface ViewData {
  pending: Conversation[];
  replied: Conversation[];
  skipped: Conversation[];
  unclassified: number;
  sync: { lastSyncAt?: string; lastError?: string; incomplete?: string };
}

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
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${avatarColor(username)} ${cls}`}
    >
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
