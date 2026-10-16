"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TranscriptSegment } from "@/lib/meetings/types";
import { useSourceNavigation } from "./source-navigation";
import { TranscriptSegmentDeleteButton } from "./transcript-segment-delete-button";

// 스크립트(전문) 뷰 — 레퍼런스: 분 단위 타임스탬프 행 + 화자 컬러 라벨 + 발화.
// 세그먼트가 수천 개일 수 있어(실측 2,005개) 청크 렌더 + 무한 스크롤로 그린다.

const CHUNK = 300;

/** 화자 → 도트/라벨 색. "나"는 파랑, "상대"는 로즈 고정, 그 외는 순환 배정. */
const FIXED_COLORS: Record<string, { dot: string; label: string }> = {
  나: { dot: "bg-sky-500", label: "text-sky-600" },
  상대: { dot: "bg-rose-400", label: "text-rose-500" },
};
const EXTRA_COLORS = [
  { dot: "bg-amber-500", label: "text-amber-600" },
  { dot: "bg-teal-500", label: "text-teal-600" },
  { dot: "bg-indigo-400", label: "text-indigo-500" },
];

function speakerColorMap(segments: readonly TranscriptSegment[]) {
  const map = new Map<string, { dot: string; label: string }>();
  let extra = 0;
  for (const s of segments) {
    if (!s.speaker || map.has(s.speaker)) continue;
    map.set(
      s.speaker,
      FIXED_COLORS[s.speaker] ?? EXTRA_COLORS[extra++ % EXTRA_COLORS.length]
    );
  }
  return map;
}

/** 초 → "MM:SS" / 1시간 넘으면 "H:MM:SS". */
function timeLabel(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function TranscriptView({
  meetingId,
  segments,
}: {
  meetingId?: string;
  segments: readonly TranscriptSegment[];
}) {
  const router = useRouter();
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);
  const currentSegments = useMemo(
    () => segments.filter((segment) => !segment.id || !removedIds.includes(segment.id)),
    [removedIds, segments]
  );
  const [visible, setVisible] = useState(CHUNK);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const navigation = useSourceNavigation();
  const targetSegmentId = navigation?.targetSegmentId;
  const targetRequestId = navigation?.targetRequestId;
  const colors = useMemo(() => speakerColorMap(currentSegments), [currentSegments]);
  const targetIndex = useMemo(
    () =>
      targetSegmentId
        ? currentSegments.findIndex(
            (segment) => segment.id === targetSegmentId
          )
        : -1,
    [targetSegmentId, currentSegments]
  );
  const renderedCount = Math.max(visible, targetIndex + 1);
  const hasTime = useMemo(
    () => currentSegments.some((s) => typeof s.t === "number" && s.t > 0),
    [currentSegments]
  );

  const onDeleted = useCallback(
    (segmentId: string) => {
      setRemovedIds((current) => [...current, segmentId]);
      router.refresh();
    },
    [router]
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visible >= currentSegments.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => Math.min(v + CHUNK, currentSegments.length));
        }
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, currentSegments.length]);

  useEffect(() => {
    if (!targetSegmentId) return;
    const target = document.getElementById(
      `transcript-${targetSegmentId}`
    );
    target?.scrollIntoView({ behavior: "auto", block: "center" });
  }, [targetSegmentId, targetRequestId, renderedCount]);

  // 렌더 행 구성: 분이 바뀔 때마다 타임스탬프 행을 끼워 넣는다(레퍼런스 패턴).
  const rows: React.ReactNode[] = [];
  let lastMinute = -1;
  for (let i = 0; i < Math.min(renderedCount, currentSegments.length); i++) {
    const seg = currentSegments[i];
    if (hasTime && typeof seg.t === "number") {
      const minute = Math.floor(seg.t / 60);
      if (minute !== lastMinute) {
        lastMinute = minute;
        rows.push(
          <p key={`t-${i}`} className="tnum pt-3 text-[11px] text-neutral-500 first:pt-0">
            {timeLabel(seg.t)}
          </p>
        );
      }
    }
    const color = seg.speaker ? colors.get(seg.speaker) : undefined;
    const isTarget = seg.id === targetSegmentId;
    rows.push(
      <div
        key={seg.id ?? i}
        id={seg.id ? `transcript-${seg.id}` : undefined}
        data-testid={seg.id ? `transcript-segment-${seg.id}` : undefined}
        className={
          isTarget
            ? "group scroll-mt-24 rounded-md bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-600/15"
            : "group rounded-md px-2 py-1.5"
        }
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {color && (
              <p className={`mb-0.5 flex items-center gap-1.5 text-[12px] font-medium ${color.label}`}>
                <span className={`size-2 rounded-full ${color.dot}`} />
                {seg.speaker}
              </p>
            )}
            <p className="break-keep text-[13px] leading-relaxed text-neutral-700 [overflow-wrap:anywhere]">
              {seg.text}
            </p>
          </div>
          {meetingId && seg.id ? (
            <TranscriptSegmentDeleteButton
              meetingId={meetingId}
              segmentId={seg.id}
              excerpt={seg.text.slice(0, 30)}
              onDeleted={onDeleted}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows}
      {visible < currentSegments.length && (
        <div ref={sentinelRef} className="py-2 text-center text-[11px] text-neutral-500">
          불러오는 중... ({visible.toLocaleString()} / {currentSegments.length.toLocaleString()})
        </div>
      )}
    </div>
  );
}
