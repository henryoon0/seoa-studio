"use client";

// 소통 작업대 — 왼쪽 아이콘 줄(댓글 · DM · 기록) + 오른쪽 화면 꽉 채움.
// 댓글은 인스타 그대로 화면(comments-insta), DM 은 쳐내기(dm-blitz), 기록은 보낸 답글 목록.
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CommentsClient } from "./comments-client";
import { DmBlitz } from "./dm-blitz";
import { IgRail } from "./ig-rail";

type Place = "comments" | "dm" | "history";

/** 레일 숫자: 남은 댓글 수 · 답할 DM 수. 못 읽으면 숫자 없이 둔다. */
function useRailCounts() {
  const [counts, setCounts] = useState<{ comments?: number; dm?: number }>({});
  const load = useCallback(async () => {
    const [c, d] = await Promise.all([
      fetch("/api/instagram/comments").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/instagram/dm").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setCounts({
      comments: (c as { pending?: unknown[] } | null)?.pending?.length,
      dm: (d as { pending?: { triage?: string; canReply?: boolean }[] } | null)?.pending?.filter((x) => x.triage !== "done").length,
    });
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return { counts, reload: load };
}

export function CommentsWorkbench() {
  const [place, setPlace] = useState<Place>("comments");
  const { counts, reload } = useRailCounts();
  const entries = [
    { key: "comments", label: "댓글", icon: "chat" as const, n: counts.comments },
    { key: "dm", label: "DM", icon: "send" as const, n: counts.dm },
    { key: "history", label: "기록", icon: "history" as const },
  ];
  return (
    <div className="flex h-[var(--inbox-h,100dvh)] min-h-0 overflow-hidden">
      <IgRail entries={entries} active={place} go={(k) => setPlace(k as Place)} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={place} className="h-[var(--inbox-h,100dvh)] min-w-0 flex-1 overflow-y-auto"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {place === "dm" ? <DmBlitz /> : <CommentsClient view={place === "history" ? "history" : "pending"} onChanged={() => void reload()} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
