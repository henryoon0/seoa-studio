"use client";
import { Icon } from "@/components/icon";

// 아래 대기줄 바 (09-27 픽: 담기 + 아래 대기줄). 화면 아래 가운데에 떠 있는 반투명 바 하나가
// 담은 것 → 보내는 중 → 끝남/멈춤을 차례로 보여준다. 위쪽의 발송 결과 띠와 선택 액션 바를 대신한다.
// 발송 자체는 서버 대기줄(무작위 10~20초 간격, 연속 3실패 정지)이 그대로 맡는다.

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import { spring } from "@/lib/springs";
import { Avatar, type QueueView } from "./comments-shared";

const ease = [0.23, 1, 0.32, 1] as const;
const press = "transition-[color,background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.96]";

type BarMode = "sending" | "stopped" | "done" | "picked" | null;

/** 끝난 결과를 보여 주는 시간. 지나면 결과는 레일 "기록"에서 본다 (한 달 전 결과가 계속 뜨던 문제). */
const RESULT_TTL_MS = 10 * 60 * 1000;

function isFresh(queue: QueueView, nowMs: number): boolean {
  const at = queue.updatedAt ? Date.parse(queue.updatedAt) : NaN;
  return Number.isFinite(at) && nowMs - at < RESULT_TTL_MS;
}

/** 바가 지금 무엇을 보여줄지. 보내는 중 > 담은 것 > 멈춤 > 방금 끝남(닫지 않았으면) 순서. */
function barMode(queue: QueueView | null, picked: number, dismissed: boolean, nowMs: number): BarMode {
  if (queue?.status === "running") return "sending";
  if (picked > 0) return "picked";
  if (!queue || dismissed || queue.items.length === 0) return null;
  if (queue.status === "stopped") return "stopped";
  if (queue.status === "done" && isFresh(queue, nowMs)) return "done";
  return null;
}

function Sending({ queue }: { queue: QueueView }) {
  return (
    <>
      <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
      <p className="shrink-0 text-[13px] text-neutral-700">
        보내는 중{" "}
        <b className="font-semibold tabular-nums text-neutral-900">
          <NumberFlow value={queue.counts.sent} />
        </b>
        <span className="text-neutral-500"> / {queue.items.length}</span>
      </p>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <motion.div
          className="h-full rounded-full bg-emerald-500"
          animate={{ width: `${(queue.counts.sent / Math.max(1, queue.items.length)) * 100}%` }}
          transition={spring.moderate}
        />
      </div>
      <span className="shrink-0 text-[11px] text-neutral-500">10~20초 간격 · 창을 닫아도 계속돼요</span>
    </>
  );
}

function Picked({
  checked,
  usernameById,
  busy,
  onSend,
  onClear,
}: {
  checked: string[];
  usernameById: Map<string, string>;
  busy: boolean;
  onSend: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <p className="shrink-0 text-[13px] text-neutral-700">
        담은{" "}
        <b className="font-semibold tabular-nums text-neutral-900">
          <NumberFlow value={checked.length} />
        </b>
      </p>
      <div className="flex -space-x-1.5">
        {checked.slice(0, 5).map((id) => (
          <span key={id} className="rounded-full ring-2 ring-white">
            <Avatar username={usernameById.get(id) ?? "?"} size="sm" />
          </span>
        ))}
      </div>
      <span className="truncate text-[11px] text-neutral-500">10~20초 간격으로 하나씩 나가요</span>
      <span className="ml-auto" />
      <button
        type="button"
        onClick={onClear}
        className={`inline-flex h-9 shrink-0 items-center rounded-[10px] px-2.5 text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 ${press}`}
      >
        비우기
      </button>
      {/* 발송은 핵심 액션 — 모션 장식 없이 평범한 버튼 (2026-08-04 DM 보내기 렌더 누락 사고와 동일 방어) */}
      <button
        type="button"
        onClick={onSend}
        disabled={busy}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-emerald-700 px-3.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 ${press}`}
      >
        <Icon name="send" className="size-3.5" />
        {busy ? "담는 중..." : `${checked.length}개 보내기`}
      </button>
    </>
  );
}

function Result({
  queue,
  stopped,
  onRetryFailed,
  onDismiss,
}: {
  queue: QueueView;
  stopped: boolean;
  onRetryFailed: (ids: string[]) => void;
  onDismiss: () => void;
}) {
  const failed = queue.items.filter((i) => i.status === "failed");
  const message = stopped
    ? (queue.stopReason ?? "발송이 멈췄어요")
    : `다 보냈어요 · 성공 ${queue.counts.sent}건${failed.length > 0 ? ` · 실패 ${failed.length}건` : ""}${queue.counts.unknown > 0 ? ` · 확인 필요 ${queue.counts.unknown}건 (인스타에서 직접 확인하세요)` : ""}`;
  return (
    <>
      {stopped ? <Icon name="warning" className="size-4 shrink-0 text-rose-600" /> : <span className="size-1.5 rounded-full bg-emerald-500" />}
      <p className={`min-w-0 truncate text-[13px] ${stopped ? "text-rose-700" : "text-neutral-700"}`}>{message}</p>
      <span className="ml-auto" />
      {failed.length > 0 ? (
        <button
          type="button"
          onClick={() => onRetryFailed(failed.map((i) => i.commentId))}
          className={`inline-flex h-9 shrink-0 items-center rounded-[10px] px-3 text-xs font-medium text-rose-700 ring-1 ring-neutral-950/5 hover:bg-rose-50 ${press}`}
        >
          실패 {failed.length}건 다시
        </button>
      ) : null}
      <button
        type="button"
        aria-label="닫기"
        onClick={onDismiss}
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-neutral-500 hover:bg-neutral-50 ${press}`}
      >
        <Icon name="close" className="size-4" />
      </button>
    </>
  );
}

export function CommentSendBar({
  checked,
  usernameById,
  queue,
  busy,
  onSend,
  onClear,
  onRetryFailed,
}: {
  checked: string[];
  usernameById: Map<string, string>;
  queue: QueueView | null;
  busy: boolean;
  onSend: () => void;
  onClear: () => void;
  onRetryFailed: (ids: string[]) => void;
}) {
  // 끝난 결과는 한 번 보고 닫으면 다시 안 뜬다 (같은 대기줄 결과가 계속 자리를 차지하던 문제)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const resultKey = queue ? `${queue.status}:${queue.items.map((i) => i.commentId).join(",")}` : null;
  // 렌더 중 Date.now() 는 순수하지 않아 마운트 시각을 한 번 잡아 둔다. 방금 끝난 대기줄은 폴링이 새로 그려 준다.
  const [mountedAt] = useState(() => Date.now());
  const nowMs = Math.max(mountedAt, queue?.updatedAt ? Date.parse(queue.updatedAt) : 0);
  const mode = barMode(queue, checked.length, dismissedKey === resultKey, nowMs);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-6">
      <AnimatePresence>
        {mode ? (
          <motion.div
            key="bar"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease }}
            className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl bg-white/80 px-4 py-2.5 shadow-[0_-1px_0_0_rgba(10,10,10,0.05),0_8px_24px_-12px_rgba(10,10,10,0.18)] ring-1 ring-neutral-950/5 backdrop-blur-xl"
          >
            {mode === "picked" ? (
              <Picked checked={checked} usernameById={usernameById} busy={busy} onSend={onSend} onClear={onClear} />
            ) : queue && mode === "sending" ? (
              <Sending queue={queue} />
            ) : queue ? (
              <Result queue={queue} stopped={mode === "stopped"} onRetryFailed={onRetryFailed} onDismiss={() => setDismissedKey(resultKey)} />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
