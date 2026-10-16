"use client";
import { Icon } from "@/components/icon";

// 한 장씩 모드 (09-27 픽 메모: "질문 먼저 UI 를 쓰지만 한 장씩 넘기며 하나씩 답할 수도").
// 순서는 목록과 같은 질문 먼저. 오른쪽으로 던지면 발송에 담기, 왼쪽은 건너뛰기. ←/→ 키도 같다.
// 카드 안에서 초안을 고르고 고칠 수 있어야 하므로, 입력칸·버튼에서 시작한 포인터는 끌기를 시작하지 않는다.
//
// 모션(apple-design): 놓은 속도를 그대로 이어받아 날아가고, 멀리 못 던졌으면 같은 속도로 제자리에 돌아온다.
// 던지는 제스처 뒤라 bounce 0.2. 다음 카드는 뒤에서 한 단 올라온다.

import { useEffect, useState } from "react";
import NumberFlow from "@number-flow/react";
import { animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { spring } from "@/lib/springs";
import { CommentContext } from "./comment-context";
import { DraftChips } from "./comment-reply-card";
import type { Comment, DiscoveryEntry, MediaInfo } from "./comments-shared";

const FLING_DISTANCE = 120;
const FLING_VELOCITY = 500;
type Dir = "queue" | "skip";

/** 입력칸·버튼에서 시작한 포인터는 카드 끌기로 번지지 않게 한다 */
const stopDrag = { onPointerDownCapture: (e: React.PointerEvent) => e.stopPropagation() };

function SwipeCard({
  c,
  media,
  discovery,
  draft,
  onDraft,
  fling,
  onGone,
  drafting,
}: {
  c: Comment;
  media: MediaInfo | undefined;
  discovery: Record<string, DiscoveryEntry>;
  draft: string;
  onDraft: (text: string) => void;
  fling: Dir | null;
  onGone: (dir: Dir) => void;
  drafting: boolean;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-6, 6]);
  const queueOpacity = useTransform(x, [20, FLING_DISTANCE], [0, 1]);
  const skipOpacity = useTransform(x, [-FLING_DISTANCE, -20], [1, 0]);
  const [flying, setFlying] = useState(false);

  const flyOut = (dir: Dir, velocity: number) => {
    if (flying) return;
    setFlying(true);
    void animate(x, dir === "queue" ? 720 : -720, { type: "spring", velocity, bounce: 0.2, duration: 0.35 }).then(() => onGone(dir));
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    const canQueue = draft.trim().length > 0;
    if (canQueue && (offset.x > FLING_DISTANCE || velocity.x > FLING_VELOCITY)) flyOut("queue", velocity.x);
    else if (offset.x < -FLING_DISTANCE || velocity.x < -FLING_VELOCITY) flyOut("skip", velocity.x);
    else void animate(x, 0, { type: "spring", velocity: velocity.x, bounce: 0.2, duration: 0.3 });
  };

  // 버튼·키보드로 들어온 던지기 — 드래그와 같은 경로로 날아간다
  useEffect(() => {
    if (!fling) return;
    const controls = animate(x, fling === "queue" ? 720 : -720, {
      type: "spring",
      velocity: fling === "queue" ? 800 : -800,
      bounce: 0.2,
      duration: 0.35,
    });
    void controls.then(() => onGone(fling));
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 던질 방향이 바뀔 때만 시작한다
  }, [fling]);

  return (
    <motion.div
      drag={flying || fling ? false : "x"}
      dragMomentum={false}
      style={{ x, rotate }}
      onDragEnd={onDragEnd}
      initial={{ scale: 0.96, y: 10, opacity: 0.9 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={spring.moderate}
      className="absolute inset-0 cursor-grab touch-pan-y overflow-y-auto rounded-[18px] bg-white p-5 shadow-[0_1px_2px_rgba(10,10,10,0.04),0_8px_24px_-8px_rgba(10,10,10,0.14)] ring-1 ring-neutral-950/5 active:cursor-grabbing"
    >
      <motion.span style={{ opacity: queueOpacity }} className="absolute right-4 top-4 z-10 rounded-md bg-emerald-700 px-2 py-1 text-[11px] font-medium text-white">
        담기
      </motion.span>
      <motion.span style={{ opacity: skipOpacity }} className="absolute left-4 top-4 z-10 rounded-md bg-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-700">
        건너뜀
      </motion.span>
      <div className="space-y-4">
        <CommentContext key={c.id} current={c} currentMedia={media} discovery={discovery} setLightbox={() => {}} />
        <div {...stopDrag} className="cursor-auto rounded-[18px] bg-white p-1 ring-1 ring-neutral-950/5">
          <DraftChips options={c.draftOptions} value={draft} onPick={onDraft} drafting={drafting} />
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            rows={3}
            placeholder={drafting ? "초안이 곧 들어와요" : "따뜻하게 한마디 남겨주세요"}
            className="w-full resize-none rounded-[14px] bg-white px-4 pb-2 pt-3 text-[15px] leading-[1.6] text-neutral-800 focus:outline-none"
          />
        </div>
      </div>
    </motion.div>
  );
}

export function CommentStack({
  list,
  total,
  media,
  discovery,
  drafts,
  onDraft,
  onQueue,
  onSkip,
  drafting,
}: {
  /** 질문 먼저 순서, 이미 담긴 댓글은 뺀 목록 */
  list: Comment[];
  /** 남은 답글 전체 (담긴 것 포함) */
  total: number;
  media: Record<string, MediaInfo>;
  discovery: Record<string, DiscoveryEntry>;
  drafts: Record<string, string>;
  onDraft: (commentId: string, text: string) => void;
  onQueue: (commentId: string) => void;
  onSkip: (commentId: string) => void;
  drafting: boolean;
}) {
  const [flight, setFlight] = useState<Dir | null>(null);
  const top = list[0];
  const topDraft = top ? (drafts[top.id] ?? top.draft ?? "") : "";

  const throwTop = (dir: Dir) => {
    if (!top || flight) return;
    if (dir === "queue" && !topDraft.trim()) return;
    setFlight(dir);
  };

  // ←/→ 키. 입력 중에는 글자 이동이라 가로채지 않는다. 키보드 동작이라 추가 애니메이션 없이 같은 던지기만.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (e.key === "ArrowRight") throwTop("queue");
      else if (e.key === "ArrowLeft") throwTop("skip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const gone = (dir: Dir) => {
    if (top) (dir === "queue" ? onQueue : onSkip)(top.id);
    setFlight(null);
  };

  return (
    <div className="mx-auto max-w-xl">
      <p className="mb-3 text-center text-[12px] text-neutral-500">
        남은 <b className="font-semibold tabular-nums text-neutral-800"><NumberFlow value={list.length} /></b>
        <span className="tabular-nums"> / {total}</span> · 오른쪽으로 던지면 담기, 왼쪽은 건너뛰기
      </p>
      <div className="relative h-[460px]">
        {list
          .slice(1, 3)
          .map((c, i) => (
            <motion.div
              key={c.id}
              layout
              animate={{ scale: 1 - (i + 1) * 0.04, y: (i + 1) * 12, opacity: 1 - (i + 1) * 0.25 }}
              transition={spring.moderate}
              className="absolute inset-0 rounded-[18px] bg-white ring-1 ring-neutral-950/5"
              style={{ zIndex: 2 - i }}
            />
          ))
          .reverse()}
        {top ? (
          <div className="absolute inset-0" style={{ zIndex: 10 }}>
            <SwipeCard
              key={top.id}
              c={top}
              media={media[top.mediaId]}
              discovery={discovery}
              draft={topDraft}
              onDraft={(text) => onDraft(top.id, text)}
              fling={flight}
              onGone={gone}
              drafting={drafting}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[18px] bg-white ring-1 ring-neutral-950/5">
            <Icon name="check" className="size-6 text-emerald-500" />
            <p className="text-sm text-neutral-600">모두 넘겼어요. 담은 것은 아래에서 보내면 돼요.</p>
          </div>
        )}
      </div>
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => throwTop("skip")}
          disabled={!top}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs text-neutral-500 transition-[color,background-color,scale] duration-150 hover:bg-neutral-100 hover:text-neutral-700 active:scale-[0.96] disabled:opacity-40"
        >
          <Icon name="arrow-left" className="size-3.5" /> 건너뛰기
        </button>
        <button
          type="button"
          onClick={() => throwTop("queue")}
          disabled={!top || !topDraft.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-emerald-700 px-3.5 text-xs font-medium text-white transition-[background-color,scale] duration-150 hover:bg-emerald-800 active:scale-[0.96] disabled:opacity-40"
        >
          발송에 담기 <Icon name="arrow-right" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
