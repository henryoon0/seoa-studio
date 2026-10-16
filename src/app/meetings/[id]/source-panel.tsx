"use client";
import { Icon } from "@/components/icon";

import { useCallback, useMemo, useState } from "react";
import type { TranscriptSegment } from "@/lib/meetings/types";
import { ContextDrawer, type ContextRequest } from "./context-drawer";
import { SourceNavigationProvider } from "./source-navigation";

// 작업대 안에서 실행 정리와 근거 원문을 전환한다.
// 복사는 현재 보이는 뷰를 따른다(실행 정리=분석 평문, 원문=전사 전문).

export function SourcePanel({
  summary,
  transcript,
  copySummary,
  copyTranscript,
  segments,
}: {
  summary: React.ReactNode;
  transcript?: React.ReactNode;
  copySummary: string;
  copyTranscript?: string;
  segments?: readonly TranscriptSegment[];
}) {
  const [context, setContext] = useState<ContextRequest>();
  const [view, setView] = useState<"summary" | "transcript">("summary");
  const [targetSegmentId, setTargetSegmentId] = useState<string>();
  const [targetRequestId, setTargetRequestId] = useState(0);
  const [copied, setCopied] = useState(false);
  const jumpToSegment = useCallback((segmentId: string) => {
    setTargetSegmentId(segmentId);
    setTargetRequestId((requestId) => requestId + 1);
    setView("transcript");
  }, []);
  const hasSegments = Boolean(segments?.length);
  const navigation = useMemo(
    () => ({
      targetSegmentId,
      targetRequestId,
      jumpToSegment,
      ...(hasSegments && {
        openContext: (evidence: ContextRequest["evidence"], label: string) => setContext({ evidence, label }),
      }),
    }),
    [hasSegments, jumpToSegment, targetRequestId, targetSegmentId]
  );

  async function copy() {
    const text = view === "summary" ? copySummary : copyTranscript;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 클립보드 거부 시 조용히 무시 */
    }
  }

  const options = [
    { key: "summary" as const, label: "실행 정리" },
    ...(transcript ? [{ key: "transcript" as const, label: "근거 원문" }] : []),
  ];

  return (
    <SourceNavigationProvider value={navigation}>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-neutral-950/[0.04] p-0.5">
          {options.map((o) => {
            const on = o.key === view;
            return (
              <button
                key={o.key}
                onClick={() => setView(o.key)}
                className={`min-h-11 rounded-md px-3 text-[12px] transition-colors sm:min-h-8 ${
                  on
                    ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-950/5"
                    : "text-neutral-600 hover:text-neutral-800"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={copy}
          className="inline-flex min-h-11 items-center gap-1 px-2 text-[12px] text-neutral-600 transition-colors hover:text-neutral-800 sm:min-h-8"
        >
          {copied ? (
            <Icon name="check" className="size-3.5 text-emerald-700" />
          ) : (
            <Icon name="copy" className="size-3.5" />
          )}
          {copied ? "복사됨" : "복사"}
        </button>
      </div>

      <div className={view === "summary" ? "" : "hidden"}>{summary}</div>
      {transcript && (
        <div className={view === "transcript" ? "card p-5" : "hidden"}>
          {transcript}
        </div>
      )}
      {context && segments && (
        <ContextDrawer
          request={context}
          segments={segments}
          onClose={() => setContext(undefined)}
          onOpenFull={(segmentId) => {
            setContext(undefined);
            jumpToSegment(segmentId);
          }}
        />
      )}
    </div>
    </SourceNavigationProvider>
  );
}
