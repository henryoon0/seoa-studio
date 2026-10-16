"use client";
import { Icon } from "@/components/icon";

// 남은 댓글 목록 (09-27 픽). 묶음 = 질문 먼저(질문·문의 / 감사 인사 / 이모지만 접힘).
// 행 모양 = "목록에서 바로 승인": 초안 한 줄 + 오른쪽 ✓. 누르면 발송에 담기고 행이 초록 띠로 접힌다.
// 담긴 행은 목록에 남아서 다시 누르면 펼쳐지며 빠진다. 실제 발송은 아래 대기줄 바의 [보내기].

import { useMemo, useState } from "react";
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import { spring } from "@/lib/springs";
import { commentIntent } from "@/lib/instagram-comments/intent";
import { Avatar, INTENT_GROUPS, relativeTime, type Comment, type DiscoveryEntry, type QueueItem } from "./comments-shared";

const rowEase = [0.23, 1, 0.32, 1] as const;

/** 질문 먼저 순서로 편 목록 — 한 장씩 모드도 이 순서를 쓴다 */
export function orderByIntent(list: Comment[]): Comment[] {
  return INTENT_GROUPS.flatMap((g) => list.filter((c) => commentIntent(c.text) === g.key));
}

function QueueLine({ item }: { item: QueueItem | undefined }) {
  if (!item) return null;
  const label =
    item.status === "queued" ? "발송 대기 중"
    : item.status === "sending" ? "보내는 중..."
    : item.status === "failed" ? "발송 실패"
    : item.status === "unknown" ? "확인 필요 · 인스타에서 직접 확인하세요"
    : "";
  if (!label) return null;
  return (
    <p className={`mt-1.5 text-[10px] font-medium ${item.status === "failed" ? "text-rose-600" : item.status === "unknown" ? "text-amber-700" : item.status === "sending" ? "text-emerald-700" : "text-neutral-500"}`}>
      {label}
    </p>
  );
}

function Row({
  c,
  active,
  checked,
  draft,
  onSelect,
  onToggle,
  queueItem,
  photoUrl,
}: {
  c: Comment;
  active: boolean;
  checked: boolean;
  draft: string;
  onSelect: () => void;
  onToggle: () => void;
  queueItem: QueueItem | undefined;
  photoUrl?: string;
}) {
  if (checked) {
    return (
      <motion.button
        layout
        type="button"
        onClick={onToggle}
        transition={spring.moderate}
        title="다시 누르면 빠져요"
        className="flex w-full items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2.5 text-left text-xs font-medium text-white transition-[background-color,scale] duration-150 hover:bg-emerald-800 active:scale-[0.98]"
      >
        <Icon name="check" className="size-3.5 shrink-0" />
        <span className="shrink-0">@{c.username}</span>
        <span className="min-w-0 truncate font-normal text-white/80">{draft}</span>
      </motion.button>
    );
  }
  // 서버 대기줄에 이미 올라간 댓글은 담기 버튼 대신 상태만 보인다
  const inServerQueue = queueItem?.status === "queued" || queueItem?.status === "sending";
  return (
    <motion.div layout transition={spring.moderate} className="relative">
      <div
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onSelect()}
        className={`w-full cursor-pointer rounded-lg p-3 pr-12 text-left ring-1 ring-neutral-950/5 transition-[background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.98] ${
          active ? "bg-emerald-50" : "bg-white hover:bg-neutral-50"
        }`}
      >
        <p className="flex items-center gap-2 text-xs">
          <Avatar username={c.username} size="sm" photoUrl={photoUrl} />
          <span className="truncate font-medium text-neutral-800">{c.profileUrl ? `@${c.username}` : c.username}</span>
          <span className="ml-auto shrink-0 text-neutral-500">{relativeTime(c.timestamp)}</span>
        </p>
        {c.parentId ? (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-neutral-500">
            <Icon name="undo" className="size-3 shrink-0 -scale-x-100" />
            이어진 대화
          </p>
        ) : null}
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-neutral-600">{c.text}</p>
        {draft ? (
          <p className="mt-1.5 line-clamp-1 text-[11px] text-emerald-700">{draft}</p>
        ) : (
          <p className="mt-1.5 text-[11px] text-neutral-500">초안 쓰는 중</p>
        )}
        <QueueLine item={queueItem} />
      </div>
      {!inServerQueue ? (
        <button
          type="button"
          aria-label="발송에 담기"
          title="발송에 담기"
          onClick={onToggle}
          disabled={!draft.trim()}
          className="absolute right-2.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-emerald-700 ring-1 ring-neutral-950/10 transition-[background-color,color,scale] duration-150 hover:bg-emerald-700 hover:text-white active:scale-[0.92] disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-emerald-700"
        >
          <Icon name="check" className="size-4" />
        </button>
      ) : null}
    </motion.div>
  );
}

export function IntentList({
  list,
  selectedId,
  onSelect,
  checked,
  onToggle,
  drafts,
  queueItemById,
  discovery,
}: {
  list: Comment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  checked: Set<string>;
  onToggle: (id: string) => void;
  drafts: Record<string, string>;
  queueItemById: Map<string, QueueItem>;
  discovery: Record<string, DiscoveryEntry>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(INTENT_GROUPS.map((g) => [g.key, !g.folded]))
  );
  const groups = useMemo(
    () => INTENT_GROUPS.map((g) => ({ ...g, rows: list.filter((c) => commentIntent(c.text) === g.key) })),
    [list]
  );

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        if (g.rows.length === 0) return null;
        const isOpen = open[g.key];
        return (
          <div key={g.key} className="space-y-1.5">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-xs font-medium text-neutral-700 transition-[background-color,scale] duration-150 hover:bg-neutral-100 active:scale-[0.98]"
            >
              <span className={`size-1.5 rounded-full ${g.dot}`} aria-hidden />
              {g.label}
              <span className="tabular-nums text-neutral-500">
                <NumberFlow value={g.rows.length} />
              </span>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-normal text-neutral-500">
                {isOpen ? "접기" : "펼치기"}
                {isOpen ? <Icon name="chevron-down" className="size-3" /> : <Icon name="chevron-right" className="size-3" />}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen
                ? g.rows.map((c) => (
                    <motion.div
                      key={c.id}
                      layout="position"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0, transition: { duration: 0.2, ease: rowEase } }}
                      transition={{ duration: 0.2, ease: rowEase }}
                      className="overflow-hidden"
                    >
                      <Row
                        c={c}
                        active={c.id === selectedId}
                        checked={checked.has(c.id)}
                        draft={drafts[c.id] ?? c.draft ?? ""}
                        onSelect={() => onSelect(c.id)}
                        onToggle={() => onToggle(c.id)}
                        queueItem={queueItemById.get(c.id)}
                        photoUrl={discovery[c.username]?.profilePictureUrl}
                      />
                    </motion.div>
                  ))
                : null}
            </AnimatePresence>
            {!isOpen ? (
              <p className="line-clamp-1 px-1 text-[11px] text-neutral-500">{g.rows.map((c) => c.text).join(" · ")}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
