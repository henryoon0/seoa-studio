"use client";

import { useEffect } from "react";
import type { AnalysisEvidenceRef, TranscriptSegment } from "@/lib/meetings/types";
import { timeLabel } from "./summary-panel/summary-utils";

const BEFORE = 4;
const AFTER = 10;
/** endSec 가 없는 근거는 시작부터 이만큼을 같은 맥락으로 칠한다. */
const DEFAULT_SPAN = 30;

export interface ContextRequest {
  readonly evidence: AnalysisEvidenceRef;
  readonly label: string;
}

/** 근거 구간 앞뒤 발언만 잘라 보여준다. 근거 구간은 노란 형광. */
export function contextWindow(segments: readonly TranscriptSegment[], evidence: AnalysisEvidenceRef) {
  const start = evidence.startSec;
  const end = evidence.endSec ?? start + DEFAULT_SPAN;
  let first = segments.findIndex((s) => s.id === evidence.segmentId);
  if (first < 0) first = segments.findIndex((s) => (s.t ?? 0) >= start);
  if (first < 0) return [];
  let last = first;
  while (last + 1 < segments.length && (segments[last + 1].t ?? Infinity) <= end) last += 1;
  return segments.slice(Math.max(0, first - BEFORE), last + AFTER + 1).map((segment, i, all) => {
    const index = segments.indexOf(all[i]);
    return { segment, marked: index >= first && index <= last };
  });
}

export function ContextDrawer({
  request,
  segments,
  onClose,
  onOpenFull,
}: {
  readonly request: ContextRequest;
  readonly segments: readonly TranscriptSegment[];
  readonly onClose: () => void;
  readonly onOpenFull: (segmentId: string) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = contextWindow(segments, request.evidence);
  const marked = rows.filter((r) => r.marked);
  const range = marked.length
    ? `${timeLabel(marked[0].segment.t ?? 0)} ~ ${timeLabel(marked[marked.length - 1].segment.t ?? 0)}`
    : timeLabel(request.evidence.startSec);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-neutral-950/20" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={`${request.label} 원문 맥락`}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.08)]"
      >
        <header className="flex items-start justify-between gap-4 px-6 py-5 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.08)]">
          <div className="min-w-0">
            <h2 className="text-pretty text-[17px] font-bold leading-snug text-neutral-950">{request.label}</h2>
            <p className="mt-1 text-[13px] text-neutral-600 tabular-nums">{range} · 화자 표시 없음(전사 원본)</p>
          </div>
          <button onClick={onClose} className="h-9 shrink-0 rounded-[10px] bg-neutral-900 px-4 text-[14px] font-semibold text-white">
            닫기
          </button>
        </header>
        <ol className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
          {rows.map(({ segment, marked: on }, i) => (
            <li
              key={segment.id ?? i}
              className={`grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-lg px-3 py-2 text-[15px] leading-relaxed ${
                on ? "bg-amber-100 text-neutral-950" : "text-neutral-800"
              }`}
            >
              <span className={`tabular-nums ${on ? "font-semibold text-neutral-900" : "text-neutral-600"}`}>
                {timeLabel(segment.t ?? 0)}
              </span>
              <span>{segment.text}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="px-3 py-2 text-[14px] text-neutral-600">이 근거의 원문을 찾지 못했습니다.</li>}
        </ol>
        <footer className="px-6 py-4 shadow-[inset_0_1px_0_0_rgba(0,0,0,0.08)]">
          <button
            onClick={() => onOpenFull(request.evidence.segmentId)}
            className="text-[14px] font-medium text-neutral-700 hover:text-neutral-950"
          >
            원문 전체에서 이 위치 보기 →
          </button>
        </footer>
      </aside>
    </div>
  );
}
