"use client";
import { Icon } from "@/components/icon";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Meeting } from "@/lib/meetings/types";

/**
 * 전사 예상 시간(분). ElevenLabs 실측: 103분 회의를 약 100초에 전사(10-16).
 * whisper 는 내 맥 CPU라 회의 길이에 비례한다. 엔진을 모르면 whisper 로 본다.
 */
export function transcribeEtaMinutes(
  meeting: Pick<Meeting, "durationSec" | "mode" | "processing">
): number | undefined {
  if (!meeting.durationSec) return undefined;
  if (meeting.processing?.engine === "elevenlabs") {
    return Math.max(1, Math.ceil((meeting.durationSec * 0.03 + 60) / 60));
  }
  const factor = meeting.mode === "remote" ? 0.7 : 0.35;
  return Math.max(1, Math.ceil((meeting.durationSec * factor + 120) / 60));
}

export function MeetingStatusBanner({ meeting }: { readonly meeting: Meeting }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const quality = meeting.transcript?.quality;

  async function retry(endpoint = "retry-transcription") {
    setRetrying(true);
    setRetryError(undefined);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/${endpoint}`, {
        method: "POST",
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "재시도 요청 실패");
      router.refresh();
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : "재시도 요청 실패");
    } finally {
      setRetrying(false);
    }
  }

  if (quality?.completeness === "partial") {
    const failures = quality.tracks.filter((track) => track.state !== "ready");
    const trackLabel = (track: string) =>
      track === "system" ? "시스템 오디오" : track === "mic" ? "마이크" : track;
    return (
      <div className="card flex items-start gap-3 bg-amber-50/60 p-4">
        <Icon name="warning" className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-amber-900">
            일부 트랙만 전사되었습니다
          </p>
          <p className="mt-0.5 text-[12px] leading-5 text-amber-800">
            {failures.map((track) => `${trackLabel(track.track)} ${track.state === "failed" ? "전사 실패" : "누락"}`).join(", ")}
            . 성공한 내용으로 회의록을 먼저 만들었습니다.
          </p>
          {retryError && <p className="mt-1 text-[11px] text-red-600">{retryError}</p>}
        </div>
        <button
          onClick={() => retry()}
          disabled={retrying}
          className="min-h-8 shrink-0 rounded bg-white px-2.5 text-[11px] font-medium text-amber-900 ring-1 ring-amber-700/20 hover:bg-amber-50 disabled:opacity-40"
        >
          {retrying ? "재시도 중..." : "실패한 트랙 다시 전사"}
        </button>
      </div>
    );
  }

  if (meeting.status === "failed") {
    return (
      <div className="card flex items-start gap-2 p-4">
        <Icon name="warning" className="mt-0.5 size-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-neutral-800">
            처리에 실패했습니다
          </p>
          {meeting.error && (
            <p className="mt-0.5 text-[12px] text-neutral-500">{meeting.error}</p>
          )}
          {retryError && <p className="mt-1 text-[11px] text-red-600">{retryError}</p>}
        </div>
        <button
          onClick={() => retry("retry-failed")}
          disabled={retrying}
          className="min-h-8 shrink-0 rounded bg-white px-2.5 text-[11px] font-medium text-neutral-800 ring-1 ring-neutral-950/15 hover:bg-neutral-50 disabled:opacity-40"
        >
          {retrying ? "다시 시도 중..." : "다시 시도"}
        </button>
      </div>
    );
  }

  if (meeting.processing?.stage === "queued") {
    return (
      <div className="card p-4">
        <p className="text-[13px] text-neutral-700">
          전사 대기 {meeting.processing.queuePosition ?? 1}번째
        </p>
        <p className="mt-0.5 text-[12px] text-neutral-500">
          다른 회의 전사가 끝나면 자동으로 시작합니다.
        </p>
      </div>
    );
  }

  const progress = meeting.transcribeProgress;
  if (meeting.status === "recorded" && progress && progress.totalSec > 0) {
    const percent = Math.min(
      100,
      Math.round((progress.processedSec / progress.totalSec) * 100)
    );
    return (
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-neutral-700">
            전사 중 ·{" "}
            <span className="tnum">{Math.floor(progress.processedSec / 60)}분</span>
            {" / "}
            <span className="tnum">{Math.ceil(progress.totalSec / 60)}분</span>
          </p>
          <span className="tnum text-[12px] text-neutral-500">{percent}%</span>
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-neutral-950/[0.06]">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  const minutes = transcribeEtaMinutes(meeting);
  const eta = minutes ? ` 약 ${minutes}분 예상이에요.` : "";
  const label =
    meeting.status === "transcribed"
      ? "전사를 마쳤어요. 분석을 정리하는 중입니다..."
      : `전사를 처리하는 중입니다.${eta || " 회의 길이의 절반쯤 걸려요."}`;

  return (
    <div className="card p-4">
      <p className="animate-pulse text-[13px] text-neutral-500">{label}</p>
    </div>
  );
}
