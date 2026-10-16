"use client";
import { Icon, icons } from "@/components/icon";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MeetingSummaryItem } from "@/lib/meetings/types";
import { MeetingTable } from "./meeting-table";
import { RecordingBar } from "./recording-bar";
import { LiveSummaryCard } from "./live-summary-card";
import { PageHeader } from "@/components/page-header";
import { SkeletonRows } from "@/components/skeleton";
import { EmptyState } from "@/components/empty-state";
import { searchMeetings } from "./meeting-operations";

export default function MeetingsPage() {
  const router = useRouter();
  const [items, setItems] = useState<MeetingSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meetings", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "조회 실패");
      setItems(json.items as MeetingSummaryItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function onDelete(meeting: MeetingSummaryItem) {
    // 확인 단계는 행의 ConfirmButton(2-step)이 담당한다 (DAS-5).
    // 낙관적 제거 후 실패 시 복구.
    const prev = items;
    setItems((list) => list.filter((m) => m.id !== meeting.id));
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제 실패");
    } catch {
      setItems(prev);
      setError("삭제하지 못했습니다");
    }
  }

  async function onUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", file);
      const res = await fetch("/api/meetings/ingest", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "업로드 실패");
      router.push(json.url as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
      setUploading(false);
    }
  }

  const visibleItems = searchMeetings(items, query);

  return (
    <div className="min-h-screen">
      <PageHeader
        title="회의"
        subtitle="녹음하면 요약·결정·할 일로 정리합니다."
        actions={
          <>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-accent min-h-11 disabled:opacity-50 sm:min-h-0"
            >
              <Icon name="upload" className="size-4" />
              {uploading ? "처리 중..." : "녹음 올리기"}
            </button>
          </>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />

      {error && (
        <div className="px-6 py-2 text-[13px] text-red-700 bg-red-50 shadow-[0_1px_0_0_rgba(10,10,10,0.05)]">
          {error}
        </div>
      )}

      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <RecordingBar onStopped={fetchAll} />
        <LiveSummaryCard />
        {loading ? (
          <SkeletonRows rows={5} />
        ) : items.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={icons["mic"]}
              title="아직 회의록이 없습니다."
              description="녹음 파일을 올리면 전사와 요약이 자동으로 만들어집니다."
              action={
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="btn-accent btn-sm disabled:opacity-50"
                >
                  <Icon name="upload" className="size-4" />
                  {uploading ? "처리 중..." : "녹음 올리기"}
                </button>
              }
            />
          </div>
        ) : (
          <section aria-label="회의 기록">
            <label className="flex max-w-sm items-center gap-2 rounded-lg bg-white px-3 shadow-[0_0_0_1px_rgba(10,10,10,0.08)]">
              <Icon name="search" className="size-4 shrink-0 text-neutral-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제목·사람·결정·할 일 검색"
                aria-label="회의 검색"
                className="min-h-9 w-full bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
              />
            </label>

            <div className="mt-3">
              {visibleItems.length ? (
                <MeetingTable meetings={visibleItems} onDelete={onDelete} />
              ) : (
                <div className="flex min-h-40 items-center justify-center bg-white text-sm text-neutral-500">
                  검색어에 맞는 회의가 없습니다.
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-neutral-400">
              {query.trim()
                ? `검색 결과 ${visibleItems.length}개 / 전체 ${items.length}개`
                : `전체 ${items.length}개 · 최근순`}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
