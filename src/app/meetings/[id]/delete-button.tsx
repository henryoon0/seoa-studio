"use client";
import { Icon } from "@/components/icon";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 회의 삭제 — 두 단계 확인(클릭 → "삭제할까요?" → 확정).
 * 확정 시 DELETE 후 목록으로 이동. 잘못 누른 삭제를 막기 위해 인라인 확인을 쓴다.
 */
export function DeleteMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "삭제 실패");
      }
      router.push("/meetings");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px]">
        <span className="text-neutral-600">삭제할까요?</span>
        <button
          onClick={remove}
          disabled={deleting}
          className="text-red-600 hover:text-red-700 disabled:opacity-40"
        >
          {deleting ? "삭제 중..." : "삭제"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="text-neutral-600 hover:text-neutral-700 disabled:opacity-40"
        >
          취소
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1 text-[12px] text-neutral-600 transition-colors hover:text-red-600"
      title={error ?? undefined}
    >
      <Icon name="trash" className="size-3.5" />
      삭제
    </button>
  );
}
