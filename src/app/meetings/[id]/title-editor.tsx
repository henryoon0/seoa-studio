"use client";
import { Icon } from "@/components/icon";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 회의 제목 인라인 편집기. 표시 우선순위: 커스텀 title → 분석 headline(fallback).
 * 빈 값으로 저장하면 커스텀 제목을 지우고 headline 으로 되돌린다.
 */
export function TitleEditor({
  meetingId,
  title,
  fallback,
}: {
  meetingId: string;
  title?: string;
  fallback: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const display = title?.trim() || fallback;

  function start() {
    setDraft(title?.trim() || fallback);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = draft.trim() === fallback ? "" : draft;
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "제목 저장 실패");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "제목 저장 실패");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-2">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            maxLength={120}
            placeholder={fallback}
            className="w-full rounded bg-white px-2 py-1 text-2xl text-display text-neutral-900 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/25"
          />
          <button
            onClick={save}
            disabled={saving}
            aria-label="제목 저장"
            className="grid size-7 shrink-0 place-items-center rounded text-neutral-600 ring-1 ring-neutral-950/10 hover:ring-neutral-950/20 disabled:opacity-40"
          >
            <Icon name="check" className="size-4" />
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            aria-label="편집 취소"
            className="grid size-7 shrink-0 place-items-center rounded text-neutral-500 ring-1 ring-neutral-950/10 hover:ring-neutral-950/20 disabled:opacity-40"
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>
        {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="group/title mt-2 flex items-center gap-2">
      <h1 className="text-2xl text-display text-neutral-900">{display}</h1>
      <button
        onClick={start}
        aria-label="제목 수정"
        className="text-neutral-300 opacity-0 transition-opacity hover:text-neutral-600 group-hover/title:opacity-100"
      >
        <Icon name="edit" className="size-4" />
      </button>
    </div>
  );
}
