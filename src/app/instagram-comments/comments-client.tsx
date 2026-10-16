"use client";
import { Icon as AppIcon, icons } from "@/components/icon";

// 인스타 댓글 답글 작업대 (wayfinder #65 → #66·#67·#81, 09-27 픽 반영).
// - 초안: 서버가 후보 3개(짧게 · 따뜻하게 · 안내 포함)를 미리 만들어 둔다. 열면 이미 들어가 있다.
// - 목록: 질문 먼저 묶음 + 행마다 ✓ 담기. [목록 | 한 장씩] 두 모드가 같은 순서·같은 담기를 쓴다.
// - 발송: 담은 것을 아래 대기줄 바에서 [보내기] → 서버 대기줄이 하나씩, 무작위 10~20초 간격 (D11).
// - 기록: 답글 완료 · 건너뜀 · 다른 대화를 한 목록 + 칩으로 (레일의 "기록").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePolling } from "@/hooks/use-polling";
import { SwapPanel } from "@/components/motion/micro";
import { CommentContext } from "./comment-context";
import { CommentHistory } from "./comment-history";
import { CommentsInsta } from "./comments-insta";
import { CommentReplyCard } from "./comment-reply-card";
import { IntentList, orderByIntent } from "./comment-rows";
import { CommentSendBar } from "./comment-send-bar";
import { CommentStack } from "./comment-stack";
import {
  postImageUrl,
  type Comment,
  type DiscoveryEntry,
  type DraftJob,
  type QueueItem,
  type QueueView,
  type ViewData,
} from "./comments-shared";

export type CommentsView = "pending" | "history";
// insta = 인스타 그대로 화면(10-06 기본). list/stack 은 ≡ 로 여는 예전 화면.
type Mode = "insta" | "list" | "stack";

const MODE_KEY = "ig-comments-mode";
const press = "transition-[color,background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.96]";


export function CommentsClient({
  view = "pending",
  onChanged,
}: {
  view?: CommentsView;
  /** 남은 수가 바뀌는 일(담아 보냄·건너뜀·동기화)이 끝나면 레일 숫자를 다시 읽게 알린다 */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<ViewData | null>(null);
  // 저장된 모드는 브라우저에서만 읽는다(서버 렌더는 "목록"). 누르면 override 가 이긴다.
  // 열 때는 항상 인스타 그대로 화면. 예전 목록·한 장씩은 이번 방문 동안만 고른 대로.
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const mode: Mode = modeOverride ?? "insta";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "sync" | "regen" | "queue">("");
  const [notice, setNotice] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [draftJob, setDraftJob] = useState<DraftJob | null>(null);
  // 발송 대기줄 (#81): checked = 담은 것, queue = 서버 대기줄
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueueView | null>(null);
  // 작성자 계정 조회 (#64) — username → 결과 (프로 계정만 사진·게시물)
  const [discovery, setDiscovery] = useState<Record<string, DiscoveryEntry>>({});
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMode = (m: Mode) => {
    setModeOverride(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // 저장이 막힌 브라우저면 이번 방문 동안만 기억한다
    }
  };

  // GET 은 원장을 읽기만 한다. POST /refresh 는 오래됐으면 동기화하고 초안 만들기를 시작한다.
  const load = useCallback(async (refresh = false) => {
    const res = refresh
      ? await fetch("/api/instagram/comments/refresh", { method: "POST" })
      : await fetch("/api/instagram/comments");
    if (!res.ok) {
      setNotice(
        res.status === 409
          ? "인스타가 아직 연결되지 않았어요. 왼쪽 위 톱니바퀴(설정)에서 인스타 토큰을 넣어 주세요."
          : "불러오기 실패. 잠시 후 다시 시도해주세요."
      );
      return;
    }
    const v = (await res.json()) as ViewData;
    setData(v);
    setDrafts((d) => {
      const next = { ...d };
      for (const c of v.pending) {
        const cur = next[c.id];
        // 아직 손 안 댄 칸(빈 칸)에는 서버 초안이 도착하는 대로 채운다
        if (cur === undefined || (cur === "" && c.draft)) next[c.id] = c.draft ?? "";
      }
      return next;
    });
    setChecked((s) => {
      const alive = new Set(v.pending.map((c) => c.id));
      const next = new Set([...s].filter((id) => alive.has(id)));
      return next.size === s.size ? s : next;
    });
  }, []);

  const loadQueue = useCallback(async () => {
    const res = await fetch("/api/instagram/comments/queue");
    if (res.ok) setQueue((await res.json()) as QueueView);
  }, []);

  const loadDraftJob = useCallback(async () => {
    const res = await fetch("/api/instagram/comments/drafts");
    if (!res.ok) return;
    const job = ((await res.json()) as { job: DraftJob | null }).job;
    setDraftJob(job);
    // 읽기(GET)는 부작용이 없다. 돌고 있는 잡이면 POST 로 고아 재개를 건다(멱등).
    if (job?.status === "running") {
      void fetch("/api/instagram/comments/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
    }
  }, []);

  // 초기 로드 1회. 원장 GET 이 후보 없는 댓글의 초안 잡을 자동으로 시작하므로 잡은 조금 뒤에 한 번 더 읽는다.
  useEffect(() => {
    load(true).then(() => loadDraftJob());
    loadQueue();
  }, [load, loadQueue, loadDraftJob]);

  // 원장 상시 갱신 — 15분. 숨은 탭에선 쉬고, 돌아오면 즉시 한 번 읽는다.
  usePolling(() => load(true), { label: "ig-comments-ledger", activeMs: 15 * 60 * 1000, active: true });

  // 발송 대기줄 폴링 — 도는 동안만 2.5초 간격
  const pollQueue = useCallback(async () => {
    await Promise.all([loadQueue(), load()]);
    onChanged?.();
  }, [loadQueue, load, onChanged]);
  usePolling(pollQueue, { label: "ig-comments-queue", enabled: queue?.status === "running", activeMs: 2500, active: true });

  // 초안 잡 폴링 — 도는 동안만 3초 간격 (후보가 도착하는 대로 칸에 채워진다)
  const pollDraftJob = useCallback(async () => {
    await Promise.all([loadDraftJob(), load()]);
    onChanged?.(); // 레일의 "초안 쓰는 중 N개"도 같이 줄어든다
  }, [loadDraftJob, load, onChanged]);
  usePolling(pollDraftJob, { label: "ig-comments-drafts", enabled: draftJob?.status === "running", activeMs: 3000, active: true });

  const ordered = useMemo(() => orderByIntent(data?.pending ?? []), [data]);
  const current: Comment | null = ordered.find((c) => c.id === selectedId) ?? ordered[0] ?? null;
  const currentMedia = current ? data?.media[current.mediaId] : null;
  const queueItemById = useMemo(() => {
    const m = new Map<string, QueueItem>();
    for (const i of queue?.items ?? []) m.set(i.commentId, i);
    return m;
  }, [queue]);
  const usernameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of [...(data?.pending ?? []), ...(data?.replied ?? []), ...(data?.skipped ?? []), ...(data?.others ?? [])])
      m.set(c.id, c.username);
    return m;
  }, [data]);
  const drafting = draftJob?.status === "running";

  // 상대 계정 조회: 목록에 보이는 사람들을 서버 캐시(3일) 기반으로 lazy 조회.
  //
  // ⚠ discovery 를 의존성에 넣으면 안 된다 (2026-08-31 실측). 이 effect 가 discovery 를
  // 채우므로, 한 명을 채울 때마다 effect 가 재실행되고 클린업이 진행 중이던 루프를
  // cancelled 로 만든다 — 15명 조회에 요청 150번이 나갔다(10배).
  // 이미 요청한 사람은 ref 로 기억한다. 실패한 사람만 지워 다음 기회에 다시 시도한다.
  const requestedRef = useRef<Set<string>>(new Set());
  const visible = view === "pending" ? data?.pending : data?.replied;
  useEffect(() => {
    if (!visible) return;
    const usernames = [...new Set(visible.map((c) => c.username))].filter(
      (u) => u && u !== "(알 수 없음)" && !requestedRef.current.has(u)
    );
    if (usernames.length === 0) return;
    for (const u of usernames) requestedRef.current.add(u);
    let cancelled = false;
    (async () => {
      for (const u of usernames) {
        try {
          const res = await fetch(`/api/instagram/comments/discovery?username=${encodeURIComponent(u)}`);
          if (!res.ok) {
            requestedRef.current.delete(u);
            continue;
          }
          const entry = (await res.json()) as DiscoveryEntry;
          if (!cancelled) setDiscovery((d) => ({ ...d, [u]: entry }));
        } catch {
          // 조회 실패는 조용히 — 이니셜 아바타를 유지하고 다음 기회에 다시 시도한다
          requestedRef.current.delete(u);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const saveDraft = (commentId: string, draft: string) => {
    setDrafts((d) => ({ ...d, [commentId]: draft }));
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      fetch("/api/instagram/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, draft }),
      }).catch(() => {});
    }, 600);
  };

  const setSkip = async (commentId: string, skipped: boolean) => {
    setChecked((s) => {
      if (!s.has(commentId)) return s;
      const next = new Set(s);
      next.delete(commentId);
      return next;
    });
    await fetch("/api/instagram/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId, skipped }),
    });
    setSelectedId(null);
    await load();
    onChanged?.();
  };

  const syncNow = async () => {
    setBusy("sync");
    setNotice("");
    try {
      const res = await fetch("/api/instagram/comments/sync", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setNotice(body.error ?? "동기화 실패");
      }
      await load();
      await loadDraftJob();
      onChanged?.();
    } finally {
      setBusy("");
    }
  };

  const regenerate = async (commentId: string, instruction: string) => {
    setBusy("regen");
    setNotice("");
    try {
      const res = await fetch("/api/instagram/comments/drafts/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, instruction }),
      });
      const body = (await res.json()) as { draft?: string; error?: string };
      if (!res.ok || !body.draft) {
        setNotice(body.error ?? "초안 생성 실패");
        return;
      }
      setDrafts((d) => ({ ...d, [commentId]: body.draft! }));
      await load();
    } finally {
      setBusy("");
    }
  };

  // ── 발송 대기줄 (#81) ──────────────────────────────────

  const toggleChecked = (commentId: string) => {
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const startSending = async (commentIds: string[]) => {
    if (commentIds.length === 0) return;
    const empty = commentIds.find((id) => !(drafts[id] ?? "").trim());
    if (empty) {
      setSelectedId(empty);
      setMode("list");
      setNotice("답글이 빈 댓글이 있어요. 초안을 채운 뒤 보내주세요.");
      return;
    }
    setBusy("queue");
    setNotice("");
    try {
      const res = await fetch("/api/instagram/comments/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: commentIds.map((commentId) => ({ commentId, message: (drafts[commentId] ?? "").trim() })) }),
      });
      const body = (await res.json()) as QueueView & { error?: string };
      if (!res.ok) {
        setNotice(body.error ?? "발송 시작 실패");
        return;
      }
      setQueue(body);
      setChecked(new Set());
    } finally {
      setBusy("");
    }
  };

  const unqueue = async (commentId: string) => {
    const res = await fetch("/api/instagram/comments/queue", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId }),
    });
    const body = (await res.json().catch(() => ({}))) as QueueView & { error?: string };
    if (res.ok) setQueue(body);
    else setNotice(body.error ?? "회수 실패"); // 409: 이미 인스타에 보낸 적이 있는 답글
  };

  const draftProgress = drafting && draftJob
    ? `${draftJob.done.length + draftJob.failed.length}/${draftJob.commentIds.length}`
    : null;
  // 한 장씩 모드는 이미 담긴 것·서버 대기줄에 오른 것을 건너뛴다
  const stackList = ordered.filter((c) => {
    const q = queueItemById.get(c.id)?.status;
    return !checked.has(c.id) && q !== "queued" && q !== "sending";
  });

  return (
    <div className={`w-full min-w-0 ${view === "pending" && mode === "insta" ? "" : "p-6 pb-24"}`}>
      {view === "pending" && mode !== "insta" ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative inline-flex rounded-lg bg-neutral-100 p-0.5">
            {(
              [
                { key: "list", label: "목록", Icon: icons["list"] },
                { key: "stack", label: "한 장씩", Icon: icons["copy"] },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                aria-pressed={mode === m.key}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === m.key ? "bg-white text-neutral-900 shadow-[0_1px_2px_0_rgba(10,10,10,0.06)]" : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                <m.Icon className="size-3.5" />
                {m.label}
              </button>
            ))}
          </div>
          {draftProgress ? (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              초안 3개씩 쓰는 중 {draftProgress}
            </p>
          ) : null}
          <p className="ml-auto text-xs text-neutral-500">
            오늘 답글 <span className="font-semibold text-emerald-700">{data?.repliedToday ?? 0}</span>개
          </p>
          <button
            type="button"
            onClick={syncNow}
            disabled={busy === "sync"}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-500 ring-1 ring-neutral-950/5 hover:bg-neutral-50 disabled:opacity-50 ${press}`}
          >
            <AppIcon name="refresh" className={`size-3 ${busy === "sync" ? "animate-spin" : ""}`} />
            동기화
          </button>
        </div>
      ) : null}

      {data?.sync.lastError ? (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-600 ring-1 ring-neutral-950/5">
          마지막 동기화 오류: {data.sync.lastError}
        </p>
      ) : null}
      {data?.sync.incomplete ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 ring-1 ring-neutral-950/5">
          동기화 미완료: {data.sync.incomplete}
        </p>
      ) : null}
      {notice ? <p className="mb-3 px-1 text-xs text-rose-600">{notice}</p> : null}
      {!data ? <p className="p-3 text-xs text-neutral-500">불러오는 중...</p> : null}

      {data && view === "history" ? (
        <CommentHistory data={data} discovery={discovery} onRestore={(id) => setSkip(id, false)} setLightbox={setLightbox} />
      ) : null}

      {data && view === "pending" && mode === "insta" ? (
        <CommentsInsta list={ordered} media={data.media} discovery={discovery} syncing={busy === "sync"} onSync={() => void syncNow()}
          onSkip={(id) => void setSkip(id, true)} onChanged={onChanged} />
      ) : null}

      {data && view === "pending" && mode === "stack" ? (
        <CommentStack
          list={stackList}
          total={ordered.length}
          media={data.media}
          discovery={discovery}
          drafts={drafts}
          onDraft={saveDraft}
          onQueue={(id) => setChecked((s) => new Set(s).add(id))}
          onSkip={(id) => setSkip(id, true)}
          drafting={drafting}
        />
      ) : null}

      {data && view === "pending" && mode === "list" ? (
        <div className="flex gap-4">
          <div className="w-72 shrink-0">
            {ordered.length > 0 ? (
              <IntentList
                list={ordered}
                selectedId={current?.id ?? null}
                onSelect={setSelectedId}
                checked={checked}
                onToggle={toggleChecked}
                drafts={drafts}
                queueItemById={queueItemById}
                discovery={discovery}
              />
            ) : (
              <p className="rounded-lg bg-white p-6 text-center text-xs text-neutral-500 ring-1 ring-neutral-950/5">
                답글 안 단 댓글이 없어요
              </p>
            )}
          </div>

          {/* 상세 — 목록을 아래로 스크롤해도 화면에 붙어 따라온다. 내용이 화면보다 길면 자체 스크롤 */}
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] min-w-0 flex-1 self-start overflow-y-auto">
            {current ? (
              <SwapPanel swapKey={current.id} className="space-y-4">
                <CommentContext
                  key={current.id}
                  current={current}
                  currentMedia={currentMedia}
                  discovery={discovery}
                  setLightbox={setLightbox}
                />
                <CommentReplyCard
                  key={`reply-${current.id}`}
                  value={drafts[current.id] ?? ""}
                  onChange={(text) => saveDraft(current.id, text)}
                  options={current.draftOptions}
                  drafting={drafting}
                  regenerating={busy === "regen"}
                  onRegenerate={(instruction) => regenerate(current.id, instruction)}
                  onSkip={() => setSkip(current.id, true)}
                  queued={checked.has(current.id)}
                  onToggleQueue={() => toggleChecked(current.id)}
                  inServerQueue={queueItemById.get(current.id)?.status === "queued"}
                  onUnqueue={() => unqueue(current.id)}
                />
              </SwapPanel>
            ) : (
              <div className="rounded-xl bg-white p-10 text-center text-sm text-neutral-500 shadow-card ring-1 ring-neutral-950/5">
                처리할 댓글이 없어요. 새 댓글이 달리면 여기에 쌓입니다.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {view === "pending" && mode !== "insta" ? (
        <CommentSendBar
          checked={[...checked]}
          usernameById={usernameById}
          queue={queue}
          busy={busy === "queue"}
          onSend={() => startSending([...checked])}
          onClear={() => setChecked(new Set())}
          onRetryFailed={startSending}
        />
      ) : null}

      {lightbox ? (
        <div onClick={() => setLightbox(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={postImageUrl(lightbox)} alt="게시물" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
            <button
              type="button"
              onClick={() => setLightbox(null)}
              className="absolute -right-3 -top-3 flex size-8 items-center justify-center rounded-full bg-white text-neutral-700 shadow-md ring-1 ring-neutral-950/5 hover:bg-neutral-50"
              aria-label="닫기"
            >
              <AppIcon name="close" className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
