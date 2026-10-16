"use client";
import { Icon } from "@/components/icon";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 저장된 전사로 분석을 다시 돌린다(프롬프트 개선분을 기존 회의에 적용). */
export function ReanalyzeButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function run() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={loading}
      title="전사로 요약·정리를 다시 생성합니다"
      className={`inline-flex items-center gap-1 text-[12px] transition-colors disabled:opacity-40 ${
        error
          ? "text-red-500 hover:text-red-600"
          : "text-neutral-600 hover:text-neutral-700"
      }`}
    >
      <Icon name="refresh" className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
      {loading ? "분석 중" : error ? "재시도" : "다시 분석"}
    </button>
  );
}
