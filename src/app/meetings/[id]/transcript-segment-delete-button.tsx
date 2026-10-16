"use client";
import { Icon } from "@/components/icon";

import { useEffect, useRef, useState } from "react";

const CONFIRMATION_TIMEOUT_MS = 3_000;

export function TranscriptSegmentDeleteButton({
  meetingId,
  segmentId,
  excerpt,
  onDeleted,
}: {
  readonly meetingId: string;
  readonly segmentId: string;
  readonly excerpt: string;
  readonly onDeleted: (segmentId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  async function remove(): Promise<void> {
    if (!confirming) {
      setConfirming(true);
      setFailed(false);
      timerRef.current = setTimeout(
        () => setConfirming(false),
        CONFIRMATION_TIMEOUT_MS
      );
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    setDeleting(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteTranscriptSegmentIds: [segmentId] }),
      });
      if (!response.ok) throw new Error("발화 삭제 실패");
      onDeleted(segmentId);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setFailed(true);
      setConfirming(false);
    } finally {
      setDeleting(false);
    }
  }

  const label = `${confirming ? "발화 삭제 확인" : "발화 삭제"}: ${excerpt}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={failed ? "삭제하지 못했습니다. 다시 시도해 주세요." : undefined}
      disabled={deleting}
      onClick={(event) => {
        event.stopPropagation();
        void remove();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40 ${
        confirming || failed
          ? "bg-rose-50 text-rose-700 ring-1 ring-rose-600/10"
          : "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-950/5 hover:bg-rose-50 hover:text-rose-700"
      }`}
    >
      <Icon name="trash" className="size-3.5" />
      {deleting
        ? "삭제 중"
        : confirming
          ? "한 번 더"
          : failed
            ? "다시 시도"
            : "삭제"}
    </button>
  );
}
