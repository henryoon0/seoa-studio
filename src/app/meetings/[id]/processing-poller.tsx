"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePolling } from "@/hooks/use-polling";

// 처리 중(recorded/transcribed) 상세 화면의 자동 갱신 — 비동기 ingest 로 업로드가
// 즉시 202 를 받으므로, 완료는 이 폴링이 감지해 서버 컴포넌트를 refresh 한다.
// GET 은 읽기 전용. 매 폴링마다 POST /resume 을 먼저 보내 고아 잡을 재개한다(서버 재시작 후 탭만 열려 있어도 재개).

export function ProcessingPoller({
  status,
  processedSec,
  processingMark,
}: {
  status: string;
  /** 부분 전사 진행(초) — 바뀔 때마다 refresh 해 전사가 자라나게 한다. */
  processedSec?: number;
  processingMark?: string;
}) {
  const router = useRouter();
  const markRef = useRef("");
  markRef.current = `${status}:${processedSec ?? 0}:${processingMark ?? ""}`;

  const check = useCallback(async () => {
    const id = window.location.pathname.split("/").pop();
    if (!id) return;
    await fetch(`/api/meetings/${id}/resume`, { method: "POST" }).catch(() => {});
    const res = await fetch(`/api/meetings/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as {
      status?: string;
      transcribeProgress?: { processedSec: number };
      processing?: { stage: string; queuePosition?: number };
    };
    const mark = `${json.status}:${json.transcribeProgress?.processedSec ?? 0}:${json.processing?.stage ?? ""}:${json.processing?.queuePosition ?? ""}`;
    if (json.status && mark !== markRef.current) {
      router.refresh();
    }
  }, [router]);

  usePolling(check, { label: "meeting-processing", activeMs: 4000, active: true });

  return null;
}
