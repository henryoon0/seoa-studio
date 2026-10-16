"use client";
import { Icon } from "@/components/icon";

// 상세 창 위쪽: 게시물 한 줄 + 답할 댓글(가장 큰 글자) + 이어진 대화 + 교류 이력(접힘).
// 목록 모드의 상세 창과 한 장씩 모드의 카드가 같이 쓴다.

import { useState } from "react";
import {
  Avatar,
  Disclosure,
  Handle,
  postImageUrl,
  relativeTime,
  type Comment,
  type DiscoveryEntry,
  type MediaInfo,
} from "./comments-shared";

export function CommentContext({
  current,
  currentMedia,
  discovery,
  setLightbox,
}: {
  current: Comment;
  currentMedia: MediaInfo | null | undefined;
  discovery: Record<string, DiscoveryEntry>;
  setLightbox: (mediaId: string) => void;
}) {
  // 댓글이 바뀌면 부르는 쪽이 key={current.id} 로 새로 그려 접힘도 초기화된다.
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      {/* 게시물: 상자가 아니라 한 줄. 답글 칸과 무게를 겨루지 않는다 */}
      {currentMedia ? (
        <div className="flex items-center gap-2.5 px-1 pb-3 shadow-[0_1px_0_0_rgba(10,10,10,0.05)]">
          <button
            type="button"
            onClick={() => setLightbox(currentMedia.id)}
            className="group relative size-7 shrink-0 overflow-hidden rounded-md ring-1 ring-[oklch(0_0_0/0.1)] transition-[scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.96]"
            title="게시물 크게 보기"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={postImageUrl(currentMedia.id)}
              alt="게시물"
              className="size-full object-cover transition-opacity group-hover:opacity-90"
              loading="lazy"
            />
            {currentMedia.mediaType === "VIDEO" ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
                <Icon name="play" className="size-3" />
              </span>
            ) : null}
          </button>
          <p className="min-w-0 flex-1 truncate text-xs text-neutral-600">{currentMedia.captionFirstLine}</p>
          <p className="shrink-0 text-[11px] tabular-nums text-neutral-500">
            {currentMedia.timestamp.slice(0, 10)} · 댓글 {currentMedia.commentsCount}
          </p>
          <a
            href={currentMedia.permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-500 transition-colors duration-150 ease-[var(--motion-ease-out)] hover:text-emerald-700"
          >
            인스타에서 열기
            <Icon name="external" className="size-3" />
          </a>
        </div>
      ) : null}

      {/* 답할 말: 이 화면에서 제일 큰 글자 */}
      <div className="flex gap-3 px-1">
        <a href={current.profileUrl ?? undefined} target="_blank" rel="noreferrer" className="shrink-0">
          <Avatar username={current.username} size="lg" photoUrl={discovery[current.username]?.profilePictureUrl} />
        </a>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Handle username={current.username} profileUrl={current.profileUrl} className="text-sm" />
            <span>· {relativeTime(current.timestamp)}</span>
          </p>

          <p className="mt-1.5 text-[17px] leading-[1.55] tracking-[-0.011em] text-neutral-900">
            {current.text}
          </p>

          {/* 이어진 대화: 이 말이 어떤 대화 끝에 나온 건지. 상자 대신 왼쪽 세로 선 */}
          {current.thread ? (
            <div className="mt-3 pl-3 shadow-[inset_2px_0_0_0_rgba(10,10,10,0.08)]">
              <p className="text-xs leading-relaxed text-neutral-500">
                <span className="tabular-nums">
                  {current.thread.timestamp.slice(5, 10).replace("-", "/")}
                </span>{" "}
                {current.thread.text}
              </p>
              {current.thread.myReplyText ? (
                <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-emerald-700">
                  <Icon name="undo" className="mt-0.5 size-3 shrink-0 -scale-x-100" />
                  <span>{current.thread.myReplyText}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {/* 맥락(교류 이력 #67 + 상대 계정 #64)은 한 칩 뒤로 접는다. 상자 두 개를 하나로 */}
          <HistoryChip current={current} entry={discovery[current.username]} open={historyOpen} onToggle={() => setHistoryOpen((o) => !o)} />
        </div>
      </div>
    </>
  );
}

function PastItems({ items }: { items: Comment["history"]["items"] }) {
  return (
    <>
      {items.map((h) => (
        <div key={h.id} className="text-xs">
          <p className="leading-relaxed text-neutral-700">
            <span className="tabular-nums text-neutral-500">{h.timestamp.slice(0, 10)}</span> {h.text}
          </p>
          {h.myReplyText ? (
            <p className="mt-0.5 flex items-start gap-1 pl-3 leading-relaxed text-emerald-700">
              <Icon name="undo" className="mt-0.5 size-3 shrink-0 -scale-x-100" />
              <span>{h.myReplyText}</span>
            </p>
          ) : null}
        </div>
      ))}
    </>
  );
}

/** 상대가 프로 계정이면 최근 게시물 몇 개 (#64) */
function RecentMedia({ media, divided }: { media: NonNullable<DiscoveryEntry["recentMedia"]>; divided: boolean }) {
  if (media.length === 0) return null;
  return (
    <ul className={`space-y-1.5 ${divided ? "pt-1 shadow-[inset_0_1px_0_0_rgba(10,10,10,0.05)]" : ""}`}>
      {media.map((m, i) => (
        <li key={m.permalink ?? i} className={divided ? "pt-1.5" : ""}>
          <a href={m.permalink ?? undefined} target="_blank" rel="noreferrer" className="group flex items-start gap-1.5 text-xs text-neutral-600">
            <span className="shrink-0 pt-px text-[10px] tabular-nums text-neutral-500">
              {m.timestamp ? m.timestamp.slice(5, 10).replace("-", "/") : ""}
            </span>
            <span className="min-w-0 flex-1 line-clamp-2 leading-snug group-hover:text-emerald-700">{m.caption || "(캡션 없음)"}</span>
            <span className="shrink-0 pt-px text-[10px] tabular-nums text-neutral-500">♥{m.likeCount ?? 0}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function AccountNote({ entry }: { entry: DiscoveryEntry | undefined }) {
  if (entry?.error) return <p className="text-[10px] text-rose-500">계정 조회 오류: {entry.error}</p>;
  if (entry && !entry.found) {
    return <p className="text-[10px] text-neutral-500">개인 계정이라 사진·게시물 조회가 안 돼요 (인스타 정책상 프로 계정만 가능).</p>;
  }
  return null;
}

function historyChipModel(current: Comment, entry: DiscoveryEntry | undefined) {
  const pro = entry && !entry.error && entry.found ? entry : null;
  // 바로 위에 인용한 뿌리 댓글은 이력에서 한 번 더 보여주지 않는다
  const thread = current.thread;
  const items = current.history.items.filter((h) => !thread || !thread.text.startsWith(h.text.slice(0, 20)));
  const followers = pro ? ` · 팔로워 ${pro.followersCount?.toLocaleString() ?? "?"}` : "";
  return { pro, items, openable: items.length > 0 || Boolean(entry), followers };
}

function HistoryChip({
  current,
  entry,
  open,
  onToggle,
}: {
  current: Comment;
  entry: DiscoveryEntry | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const { pro, items, openable, followers } = historyChipModel(current, entry);
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={!openable}
        className={`mt-3 inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-[background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.96] ${
          openable ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "bg-neutral-50 text-neutral-500"
        }`}
      >
        {current.history.summary}
        {followers}
        {openable ? (
          <Icon name="chevron-down"
            className="size-3 transition-transform duration-200 ease-[var(--motion-ease-out)]"
            style={{ transform: open ? "rotate(180deg)" : "none" }}
          />
        ) : null}
      </button>
      <Disclosure open={open && openable}>
        <div className="mt-2 space-y-2.5 rounded-[14px] bg-neutral-50 p-3 ring-1 ring-neutral-950/5">
          <PastItems items={items} />
          <RecentMedia media={pro?.recentMedia ?? []} divided={items.length > 0} />
          <AccountNote entry={entry} />
        </div>
      </Disclosure>
    </>
  );
}
