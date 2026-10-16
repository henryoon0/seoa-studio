"use client";
import { Icon } from "@/components/icon";

// 댓글 기록 (09-27 픽: 한 목록 + 칩). 답글 완료 · 건너뜀 · 다른 대화 탭 3개를 목록 하나로 합치고,
// 위에 상태 칩(여러 개 켤 수 있음)과 검색 칸을 둔다. 평소엔 레일의 "기록" 한 줄 뒤에 숨어 있다.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SwapPanel } from "@/components/motion/micro";
import { CommentContext } from "./comment-context";
import { Avatar, relativeTime, type Comment, type DiscoveryEntry, type MediaInfo, type ViewData } from "./comments-shared";

type Status = "replied" | "skipped" | "others";

const STATUS: { key: Status; label: string; dot: string }[] = [
  { key: "replied", label: "답글 완료", dot: "bg-emerald-500" },
  { key: "skipped", label: "건너뜀", dot: "bg-neutral-400" },
  { key: "others", label: "다른 대화", dot: "bg-sky-500" },
];

type Rec = { c: Comment; status: Status };

const press = "transition-[color,background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.96]";

function matches(r: Rec, q: string): boolean {
  if (!q) return true;
  const needle = q.replace(/^@/, "").toLowerCase();
  return [r.c.username, r.c.text, r.c.myReplyText ?? ""].some((s) => s.toLowerCase().includes(needle));
}

function StatusPanel({
  rec,
  media,
  onRestore,
}: {
  rec: Rec;
  media: MediaInfo | undefined;
  onRestore: (commentId: string) => void;
}) {
  if (rec.status === "replied") {
    return (
      <div className="rounded-[14px] bg-emerald-50/60 p-3 ring-1 ring-neutral-950/5">
        <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
          <Icon name="check-circle" className="size-3.5" /> 내 답글
          {rec.c.repliedAt ? <span className="font-normal text-emerald-700/70">· {relativeTime(rec.c.repliedAt)}</span> : null}
        </p>
        <p className="text-sm leading-relaxed text-neutral-800">{rec.c.myReplyText || "답글을 남겼어요."}</p>
      </div>
    );
  }
  if (rec.status === "skipped") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-white p-3 ring-1 ring-neutral-950/5">
        <p className="text-[11px] text-neutral-500">건너뛴 댓글이에요. 다시 답글 대기로 되돌릴 수 있어요.</p>
        <button
          type="button"
          onClick={() => onRestore(rec.c.id)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-600 ring-1 ring-neutral-950/5 hover:bg-neutral-50 ${press}`}
        >
          <Icon name="undo" className="size-4" /> 답글 대기로 되돌리기
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] bg-white p-3 ring-1 ring-neutral-950/5">
      <p className="text-[11px] text-neutral-500">
        내 게시물에서 사람들끼리 주고받은 말이에요. 답글 대기줄에는 안 올라오고, 여기서 읽기만 해요.
      </p>
      {media ? (
        <a
          href={media.permalink}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-600 ring-1 ring-neutral-950/5 hover:bg-neutral-50 ${press}`}
        >
          <Icon name="external" className="size-4" /> 인스타에서 답하기
        </a>
      ) : null}
    </div>
  );
}

export function CommentHistory({
  data,
  discovery,
  onRestore,
  setLightbox,
}: {
  data: ViewData;
  discovery: Record<string, DiscoveryEntry>;
  onRestore: (commentId: string) => void;
  setLightbox: (mediaId: string) => void;
}) {
  const [on, setOn] = useState<Set<Status>>(new Set(["replied", "skipped", "others"]));
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all = useMemo<Rec[]>(
    () =>
      [
        ...data.replied.map((c) => ({ c, status: "replied" as const })),
        ...data.skipped.map((c) => ({ c, status: "skipped" as const })),
        ...data.others.map((c) => ({ c, status: "others" as const })),
      ].sort((a, b) => ((a.c.repliedAt ?? a.c.timestamp) < (b.c.repliedAt ?? b.c.timestamp) ? 1 : -1)),
    [data]
  );
  const counts = useMemo(() => {
    const m: Record<Status, number> = { replied: 0, skipped: 0, others: 0 };
    for (const r of all) if (matches(r, query.trim())) m[r.status] += 1;
    return m;
  }, [all, query]);
  const shown = useMemo(() => all.filter((r) => on.has(r.status) && matches(r, query.trim())), [all, on, query]);
  const current = shown.find((r) => r.c.id === selectedId) ?? shown[0] ?? null;

  const toggle = (s: Status) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-8 w-56 items-center gap-1.5 rounded-lg bg-white px-2.5 ring-1 ring-neutral-950/5 focus-within:ring-emerald-600/40">
          <Icon name="search" className="size-3.5 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="@이름 · 내용"
            className="min-w-0 flex-1 bg-transparent text-xs text-neutral-800 placeholder:text-neutral-500 focus:outline-none"
          />
        </label>
        {STATUS.map((s) => {
          const active = on.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(s.key)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs ${press} ${
                active ? "bg-white font-medium text-neutral-800 ring-1 ring-neutral-950/10" : "text-neutral-500 hover:bg-neutral-100"
              }`}
            >
              <span className={`size-1.5 rounded-full ${active ? s.dot : "bg-neutral-300"}`} aria-hidden />
              {s.label}
              <span className="tabular-nums text-neutral-500">{counts[s.key]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex gap-4">
        <div className="w-72 shrink-0 space-y-1.5">
          <AnimatePresence initial={false}>
            {shown.slice(0, 80).map((r) => (
              <motion.div
                key={r.c.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(r.c.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(r.c.id)}
                  className={`w-full cursor-pointer rounded-lg p-3 text-left ring-1 ring-neutral-950/5 transition-[background-color,scale] duration-150 active:scale-[0.98] ${
                    current?.c.id === r.c.id ? "bg-emerald-50" : "bg-white hover:bg-neutral-50"
                  }`}
                >
                  <p className="flex items-center gap-2 text-xs">
                    <Avatar username={r.c.username} size="sm" photoUrl={discovery[r.c.username]?.profilePictureUrl} />
                    <span className="truncate font-medium text-neutral-800">@{r.c.username}</span>
                    <span className={`size-1.5 shrink-0 rounded-full ${STATUS.find((s) => s.key === r.status)?.dot}`} aria-hidden />
                    <span className="ml-auto shrink-0 text-neutral-500">{relativeTime(r.c.repliedAt ?? r.c.timestamp)}</span>
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-neutral-600">{r.c.text}</p>
                  {r.status === "replied" && r.c.myReplyText ? (
                    <p className="mt-1.5 line-clamp-1 text-[11px] text-emerald-700">{r.c.myReplyText}</p>
                  ) : null}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {shown.length > 80 ? (
            <p className="px-1 pt-1 text-[11px] text-neutral-500">최근 80개만 보여요. 나머지 {shown.length - 80}개는 검색으로 찾아 주세요.</p>
          ) : null}
          {shown.length === 0 ? (
            <p className="rounded-lg bg-white p-6 text-center text-xs text-neutral-500 ring-1 ring-neutral-950/5">맞는 기록이 없어요</p>
          ) : null}
        </div>

        <div className="sticky top-6 max-h-[calc(100vh-3rem)] min-w-0 flex-1 self-start overflow-y-auto">
          {current ? (
            <SwapPanel swapKey={current.c.id} className="space-y-4">
              <CommentContext
                key={current.c.id}
                current={current.c}
                currentMedia={data.media[current.c.mediaId]}
                discovery={discovery}
                setLightbox={setLightbox}
              />
              <StatusPanel rec={current} media={data.media[current.c.mediaId]} onRestore={onRestore} />
            </SwapPanel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
