"use client";
import { Icon } from "@/components/icon";

// 댓글 답글 — 인스타 그대로 (2026-10-06 henry: "댓글도 인스타 같이, AI 댓글로 빠르게").
// 왼쪽 = 인스타 '활동' 알림처럼 "○○님이 댓글을 남겼어요" 줄(게시물 썸네일 포함),
// 오른쪽 = 게시물 보기(사진 + 댓글 + 입력칸). 입력칸엔 AI 초안이 이미 들어 있다.
// ⏎ = 초안 저장 → 서버 발송 대기줄(15~30초 무작위 간격, 기존 #81) → 즉시 다음 댓글. Esc = 건너뛰기.
// 초안 후보 3개(짧게·따뜻하게·안내 포함)는 [초안 만들기]로 고른 최신 게시물의 댓글에만 생긴다 — Tab 으로 바꾼다.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { springs } from "@/components/motion/presets";
import { relativeTime } from "./dm-shared";
import { errorOf, recoverLostEnqueue, UNKNOWN_HINT, type ServerItem } from "./queue-recovery";
import { Avatar, postImageUrl, TONE_LABEL, type Comment, type DiscoveryEntry, type MediaInfo } from "./comments-shared";

import { ACCENT } from "./dm-blitz-card";
const SENT_PAUSE_MS = 600;
const QUEUE_POLL_MS = 3000;
// 발송 대기줄 상태 (서버가 새 상태를 더해도 모르는 값은 "대기"로 본다). skipped 는 이 화면에서만 쓰는 값.
const TERMINAL = new Set(["sent", "failed", "unknown", "skipped"]);
const STATUS_LABEL: Record<string, string> = { queued: "대기 중", sending: "보내는 중", sent: "보냄", failed: "실패", unknown: "확인 필요", skipped: "건너뜀" };
const labelOf = (status: string) => STATUS_LABEL[status] ?? STATUS_LABEL.queued;
const ICON_BTN = "flex size-8 items-center justify-center rounded-full text-neutral-900 transition-colors hover:bg-neutral-950/[0.05] active:scale-[0.96]";

const ago = (iso: string) => relativeTime(iso).replace(/ 전$/, "");

/**
 * 화면에서 승인한 문구를 댓글 번호와 함께 대기줄에 담는다 (서버는 이 문구를 그대로 보낸다).
 * 초안 저장은 기록용이라 실패해도 발송을 막지 않는다. 통신 예외도 오류 글로 돌려준다.
 */
/** 대기줄에 담는다. 성공하면 서버가 확정한 문구(실제로 나갈 글)를, 실패하면 오류 글을 돌려준다. */
async function queueReply(commentId: string, text: string): Promise<{ error: string } | { message: string }> {
  let message = text;
  try {
    const res = await fetch("/api/instagram/comments/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ commentId, message: text }] }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; items?: { commentId: string; message: string }[] };
    if (!res.ok) return { error: body.error ?? "발송 담기 실패" };
    message = body.items?.find((i) => i.commentId === commentId)?.message ?? text;
  } catch {
    return { error: "서버와 연결이 끊겼어요" };
  }
  void fetch("/api/instagram/comments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId, draft: message }) }).catch(() => undefined);
  return { message };
}


async function fetchQueueItems(): Promise<ServerItem[] | null> {
  try {
    const res = await fetch("/api/instagram/comments/queue", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { items?: ServerItem[] }).items ?? [];
  } catch {
    return null;
  }
}

/** 발송 이력이 있는 항목은 서버가 문구를 고정한다 — 화면도 그 문구만 보여 준다. */
const FIXED_STATUS = new Set(["unknown", "sending", "sent"]);
const fixedOf = (items: ServerItem[]) =>
  Object.fromEntries(items.filter((i) => (i.attempts ?? 0) > 0 && FIXED_STATUS.has(i.status)).map((i) => [i.commentId, i.message]));


/** henry 가 인스타에서 직접 확인한 뒤 누르는 다시 보내기. 실패하면 오류 글을 돌려준다. */
async function resendAfterCheck(commentId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/instagram/comments/queue", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId }) });
    if (res.ok) return null;
    return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "다시 보내기 실패";
  } catch {
    return "서버와 연결이 끊겼어요";
  }
}

/** "인스타에서 다시 확인" — 서버가 조회만 한다 (발송 없음). 이 댓글의 서버 항목을 돌려준다. */
async function checkOnInstagram(commentId: string): Promise<ServerItem | string> {
  try {
    const res = await fetch("/api/instagram/comments/queue", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId, action: "check" }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; items?: ServerItem[] };
    if (!res.ok) return body.error ?? "인스타 확인 실패";
    return body.items?.find((i) => i.commentId === commentId) ?? "대기줄에서 이 댓글을 찾지 못했어요";
  } catch {
    return "서버와 연결이 끊겼어요";
  }
}

/** 대기줄에서 이 댓글의 현재 상태 (없거나 못 읽으면 null). 통신 오류 뒤 실제 등록 여부를 확인할 때 쓴다. */
async function fetchQueueItem(commentId: string): Promise<ServerItem | null> {
  return (await fetchQueueItems())?.find((i) => i.commentId === commentId) ?? null;
}

// 정렬 (10-06 henry: "≡ 필요 없고 옆에 필터로 오래된 순·최신 순"). 질문 먼저 = 예전 기본 순서(질문 → 오래된 순)
type SortKey = "old" | "new" | "question";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "old", label: "오래된 순" },
  { key: "new", label: "최신 순" },
  { key: "question", label: "질문 먼저" },
];

function sortComments(list: Comment[], key: SortKey): Comment[] {
  const t = (c: Comment) => Date.parse(c.timestamp) || 0;
  if (key === "question") return list; // 서버/작업대가 이미 질문 → 오래된 순으로 준다
  return [...list].sort((a, b) => (key === "old" ? t(a) - t(b) : t(b) - t(a)));
}

function SortMenu({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const label = SORTS.find((s) => s.key === value)?.label;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-neutral-800 ring-1 ring-neutral-950/10 hover:bg-neutral-950/[0.03] active:scale-[0.96]">
        {label}<Icon name="chevron-down" className="size-3.5 text-neutral-500" />
      </button>
      {open ? (
        <ul className="absolute right-0 top-9 z-20 w-36 rounded-xl bg-white p-1 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.18)] ring-1 ring-neutral-950/5">
          {SORTS.map((s) => (
            <li key={s.key}>
              <button type="button" onClick={() => { onChange(s.key); setOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] text-neutral-800 hover:bg-neutral-950/[0.04]">
                {s.label}{s.key === value ? <Icon name="check" className="size-3.5 text-emerald-700" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActivityRow({ c, on, done, status, photo, onClick }: { c: Comment; on: boolean; done: boolean; status?: string; photo?: string; onClick: () => void }) {
  return (
    <motion.li layout transition={springs.smooth}>
      <button type="button" onClick={onClick}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${on ? "bg-neutral-950/[0.06]" : "hover:bg-neutral-950/[0.03]"}`}>
        <Avatar username={c.username} size="lg" photoUrl={photo} />
        <span className={`line-clamp-2 min-w-0 flex-1 text-[14px] leading-snug ${done ? "text-neutral-400" : "text-neutral-950"}`}>
          <span className="font-semibold">{c.username}</span>님이 댓글을 남겼어요: {c.text} <span className="text-neutral-500">{ago(c.timestamp)}</span>
        </span>
        {done || status === "failed" || status === "unknown" ? <span className={`shrink-0 text-[12px] ${status === "failed" ? "text-rose-600" : "text-neutral-400"}`}>{labelOf(status ?? "sent")}</span> : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={postImageUrl(c.mediaId)} alt="" loading="lazy" className="size-11 shrink-0 rounded-md object-cover ring-1 ring-neutral-950/5" />
        )}
      </button>
    </motion.li>
  );
}

/** 초안 후보 탭 (Tab 키로도 오간다) + 이 사람과의 교류 한 마디 */
function DraftLine({ c, tone, onTone, toneLocked }: { c: Comment; tone: number; onTone: (k: number) => void; toneLocked: boolean }) {
  const opts = c.draftOptions ?? [];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[12px] text-neutral-500">
      {opts.length > 1 ? (
        <div className="relative inline-flex rounded-full bg-neutral-950/[0.05] p-0.5" title="Tab 으로 바꾸기">
          {opts.map((o, k) => (
            <button key={o.tone} type="button" onClick={() => onTone(k)} disabled={toneLocked}
              className={`relative rounded-full px-2.5 py-0.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${k === tone ? "text-neutral-950" : "text-neutral-500 hover:text-neutral-800"}`}>
              {k === tone ? <motion.span layoutId="ig-comment-tone" transition={springs.snappy} className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]" /> : null}
              <span className="relative">{TONE_LABEL[o.tone]}</span>
            </button>
          ))}
        </div>
      ) : null}
      <span>AI 초안</span>
      <span>· {c.interactionCount > 1 ? `교류 ${c.interactionCount}회` : "첫 교류"}</span>
    </div>
  );
}

/**
 * 입력칸 키: ⏎ 게시 · Esc 건너뛰기 · Tab 다른 초안 (⇧⏎ 는 줄바꿈).
 * 키 반복(꾹 누름)과 한글 조합 중 ⏎ 는 무시하고, 승인한 ⏎ 를 놓기(keyup) 전에는 다음 승인을 막는다.
 */
function composerKeys(e: React.KeyboardEvent, a: { send: () => void; skip: () => void; tab: (() => void) | null; enterHeld: { current: boolean } }) {
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return; // 한글 조합 확정 ⏎ 는 IME 몫
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (e.repeat || a.enterHeld.current) return;
    a.enterHeld.current = true;
    a.send();
    return;
  }
  const act = e.key === "Escape" ? a.skip : e.key === "Tab" ? a.tab : null;
  if (!act) return;
  e.preventDefault();
  if (e.repeat) return;
  act();
}

function PostHeader({ media }: { media?: MediaInfo }) {
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-3 px-4 shadow-[0_1px_0_0_rgba(10,10,10,0.08)]">
      <span className="min-w-0 flex-1 truncate text-[14px] text-neutral-950">{media?.captionFirstLine ?? "게시물"}</span>
      {media?.permalink ? <a href={media.permalink} target="_blank" rel="noreferrer" title="인스타에서 열기" className={ICON_BTN}><Icon name="external" className="size-4" /></a> : null}
    </div>
  );
}

function SentReply({ text, saved, reduce }: { text: string; saved: boolean; reduce: boolean }) {
  return (
    <motion.div className="ml-11 flex gap-3" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.snappy}>
      <Avatar username="__simplyhome" size="sm" />
      <div className="min-w-0">
        <p className="text-[14px] leading-snug text-neutral-950"><span className="font-semibold">__simplyhome</span> {text}</p>
        <p className="mt-1 text-[12px] text-neutral-500">{saved ? "방금 · 보내는 줄에 담았어요" : "보내는 줄에 담는 중..."}</p>
      </div>
    </motion.div>
  );
}

function PostView({
  c, media, photo, text, onText, tone, onTone, toneLocked, sent, error, locked, enterHeld, onSend, onSkip, onResend, onCheck,
}: {
  c: Comment; media?: MediaInfo; photo?: string; text: string; onText: (v: string) => void;
  tone: number; onTone: (k: number) => void; toneLocked: boolean; sent: { text: string; saved: boolean } | null; error: string;
  locked: string; enterHeld: { current: boolean }; onSend: () => void; onSkip: () => void;
  /** unknown 잠금일 때만: 인스타에서 확인한 뒤 같은 문구로 다시 보내기 */
  onResend: (() => void) | null;
  /** unknown 잠금일 때만: 보내지 않고 인스타에서 달렸는지 조회만 */
  onCheck: (() => void) | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();
  const opts = c.draftOptions ?? [];
  useEffect(() => { ref.current?.focus(); }, [c.id]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text, sent]);
  const keys = (e: React.KeyboardEvent) => composerKeys(e, { send: onSend, skip: onSkip, tab: opts.length > 1 && !toneLocked ? () => onTone((tone + 1) % opts.length) : null, enterHeld });
  return (
    <div className="flex min-w-0 flex-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={postImageUrl(c.mediaId)} alt="게시물" className="hidden h-full w-[38%] shrink-0 bg-neutral-950 object-contain lg:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <PostHeader media={media} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex gap-3">
            <Avatar username={c.username} size="md" photoUrl={photo} />
            <div className="min-w-0">
              <p className="whitespace-pre-wrap text-[14px] leading-snug text-neutral-950"><span className="font-semibold">{c.username}</span> {c.text}</p>
              <p className="mt-1 text-[12px] text-neutral-500">{ago(c.timestamp)} · 답글 달기</p>
            </div>
          </div>
          {sent ? <SentReply text={sent.text} saved={sent.saved} reduce={!!reduce} /> : null}
        </div>
        <div className="shrink-0 p-4 shadow-[0_-1px_0_0_rgba(10,10,10,0.08)]">
          <div className="flex items-end gap-3">
            <textarea ref={ref} rows={1} value={sent ? "" : text} disabled={!!sent || !!locked || toneLocked} onChange={(e) => onText(e.target.value)} onKeyDown={keys}
              placeholder={opts.length ? "댓글 달기..." : "초안 쓰는 중..."}
              className="min-w-0 flex-1 resize-none bg-transparent text-[14px] leading-[1.45] text-neutral-950 outline-none placeholder:text-neutral-500" />
            {text.trim() && !sent ? (
              <button type="button" onClick={onSend} className="shrink-0 text-[14px] font-semibold transition-opacity hover:opacity-70 active:scale-[0.96]" style={{ color: ACCENT }}>게시</button>
            ) : null}
          </div>
          {error && !sent ? <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}
          {locked && !sent ? <p className="mt-2 text-[12px] text-neutral-500">{locked}</p> : null}
          {onCheck && !sent ? (
            <button type="button" onClick={onCheck} className="mt-2 mr-2 rounded-full px-3 py-1 text-[12px] font-medium text-neutral-800 ring-1 ring-neutral-950/10 hover:bg-neutral-950/[0.03] active:scale-[0.96]">
              인스타에서 다시 확인
            </button>
          ) : null}
          {onResend && !sent ? (
            <button type="button" onClick={onResend} className="mt-2 rounded-full px-3 py-1 text-[12px] font-medium text-neutral-800 ring-1 ring-neutral-950/10 hover:bg-neutral-950/[0.03] active:scale-[0.96]">
              인스타에서 확인했어요, 다시 보내기
            </button>
          ) : null}
          {sent ? null : <DraftLine c={c} tone={tone} onTone={onTone} toneLocked={toneLocked} />}
        </div>
      </div>
    </div>
  );
}

export function CommentsInsta({
  list: live, media, discovery, syncing, onSync, onSkip, onChanged, draftProgress, onOpenDrafts,
}: {
  list: Comment[]; media: Record<string, MediaInfo>; discovery: Record<string, DiscoveryEntry>;
  syncing: boolean; onSync: () => void; onSkip: (id: string) => void; onChanged?: () => void;
  /** 초안 잡이 도는 중이면 "3/10", 아니면 null */
  draftProgress: string | null; onOpenDrafts: () => void;
}) {
  // 서버 갱신(새 초안·새로 동기화한 댓글)은 댓글 id 로 합친다. 보낸 댓글이 재조회로 사라져도 줄이 흔들리지 않게 예전 항목은 남긴다.
  const [snapshot, setSnapshot] = useState(live);
  useEffect(() => {
    setSnapshot((prev) => {
      const byId = new Map(live.map((x) => [x.id, x]));
      const known = new Set(prev.map((x) => x.id));
      return [...prev.map((x) => byId.get(x.id) ?? x), ...live.filter((x) => !known.has(x.id))];
    });
  }, [live]);
  const [sort, setSort] = useState<SortKey>("old");
  const list = sortComments(snapshot, sort);
  const [cur, setCur] = useState<string | null>(list[0]?.id ?? null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [qs, setQs] = useState<Record<string, string>>({}); // 댓글 id → 대기줄 상태
  const [qerr, setQerr] = useState<Record<string, string>>({}); // 댓글 id → 오류 글 (저장·담기·발송 실패)
  const [tones, setTones] = useState<Record<string, number>>({});
  const [texts, setTexts] = useState<Record<string, string>>({}); // 사용자가 직접 고친 글. 서버 갱신이 덮어쓰지 않는다.
  const [sent, setSent] = useState<{ id: string; text: string; saved: boolean } | null>(null);
  // 발송을 시도한(결과 불명·보내는 중·보냄) 항목의 서버 고정 문구. 초안 전환·수정으로 바뀌지 않는다.
  const [fixed, setFixed] = useState<Record<string, string>>({});
  const enterHeld = useRef(false);
  const stateRef = useRef({ cur, done, qs });
  stateRef.current = { cur, done, qs };
  const c = list.find((x) => x.id === cur) ?? null;
  // 발송 실패는 다시 보낼 수 있게 '끝난 댓글'에서 뺀다
  const settled = (x: Comment) => !!done[x.id] && qs[x.id] !== "failed";
  const left = list.filter((x) => !settled(x)).length;
  const order = [...list].sort((a, b) => Number(settled(a)) - Number(settled(b)));

  // 처음 열 때 서버 대기줄을 읽어 화면에 반영한다. 새로고침해도 결과 불명 잠금과
  // 이미 보낸 적 있는 문구(바꿀 수 없음)가 그대로 보이게 한다.
  useEffect(() => {
    let alive = true;
    void fetchQueueItems().then((items) => {
      if (!alive || !items) return;
      setQs((prev) => ({ ...Object.fromEntries(items.map((i) => [i.commentId, i.status])), ...prev }));
      setQerr((prev) => {
        const n = { ...prev };
        for (const i of items) { const e = errorOf(i); if (e && !(i.commentId in n)) n[i.commentId] = e; }
        return n;
      });
      setTexts((prev) => ({ ...Object.fromEntries(items.filter((i) => (i.attempts ?? 0) > 0).map((i) => [i.commentId, i.message])), ...prev }));
      setFixed((prev) => ({ ...prev, ...fixedOf(items) }));
      // 대기 중·보내는 중·보냄은 이미 처리한 댓글이다 (폴링이 결과를 계속 읽는다).
      setDone((prev) => ({ ...Object.fromEntries(items.filter((i) => ["queued", "sending", "sent"].includes(i.status)).map((i) => [i.commentId, i.message])), ...prev }));
    });
    return () => { alive = false; };
  }, []);

  // Enter 를 놓아야 다음 승인을 받는다
  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.key === "Enter") enterHeld.current = false; };
    const reset = () => { enterHeld.current = false; };
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    return () => { window.removeEventListener("keyup", up); window.removeEventListener("blur", reset); };
  }, []);

  // 담은 댓글의 실제 발송 결과를 대기줄에서 읽어 온다 (읽기만 한다)
  const watching = Object.keys(done).filter((id) => !TERMINAL.has(qs[id] ?? "queued")).join(",");
  useEffect(() => {
    if (!watching) return;
    const ids = watching.split(",");
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/instagram/comments/queue", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const body = (await res.json()) as { items?: ServerItem[] };
        const items = new Map((body.items ?? []).map((i) => [i.commentId, i]));
        setFixed((prev) => {
          const n = { ...prev };
          for (const id of ids) delete n[id];
          return { ...n, ...fixedOf(ids.flatMap((id) => items.get(id) ?? [])) };
        });
        setQs((prev) => { const n = { ...prev }; for (const id of ids) { const i = items.get(id); if (i) n[id] = i.status; } return n; });
        setQerr((prev) => {
          const n = { ...prev };
          for (const id of ids) {
            const i = items.get(id);
            if (i?.status === "failed") n[id] = i.error ? `발송에 실패했어요: ${i.error}` : "발송에 실패했어요. 다시 보내 보세요.";
            else if (i?.status === "unknown") n[id] = i.error ?? UNKNOWN_HINT;
          }
          return n;
        });
        if (items.size) onChanged?.();
      } catch { /* 다음 주기에 다시 */ }
    };
    void poll();
    const t = setInterval(poll, QUEUE_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [watching, onChanged]);

  const textOf = (x: Comment) => fixed[x.id] ?? texts[x.id] ?? x.draftOptions?.[tones[x.id] ?? 0]?.text ?? x.draft ?? "";
  const next = (id: string, d: Record<string, string>) => list.find((x) => x.id !== id && !d[x.id])?.id ?? null;
  const tone = (k: number) => { if (!c || c.id in fixed) return; setTones((t) => ({ ...t, [c.id]: k })); setTexts((t) => { const n = { ...t }; delete n[c.id]; return n; }); };

  const send = () => {
    if (!c || sent || qs[c.id] === "unknown") return;
    const text = textOf(c).trim();
    if (!text) return;
    const id = c.id;
    setSent({ id, text, saved: false });
    setQerr((e) => { const n = { ...e }; delete n[id]; return n; });
    void queueReply(id, text).then(async (res) => {
      if ("error" in res) {
        const err = res.error; // 담기에 실패하면 완료로 치지 않고 글을 그대로 둔다. 화면 잠금은 바로 푼다.
        setSent(null);
        setQerr((e) => ({ ...e, [id]: `${err}. 글은 그대로 두었어요. 다시 ⏎ 를 눌러 보세요.` }));
        // 응답만 끊기고 서버엔 담겼을 수 있다 — 서버 상태를 다시 읽어 화면에 반영한다.
        const item = await fetchQueueItem(id);
        const found = recoverLostEnqueue(item);
        if (item && found) {
          setQs((q) => ({ ...q, [id]: found.status }));
          setFixed((f) => ({ ...f, ...fixedOf([item]) }));
          setTexts((t) => ({ ...t, [id]: found.message }));
          setQerr((e) => { const n = { ...e }; if (found.error) n[id] = found.error; else delete n[id]; return n; });
          // 진행 중·보냄은 추적 목록에 넣어 폴링이 이후 실패·결과 불명도 읽게 한다.
          if (found.track) {
            const d = { ...stateRef.current.done, [id]: found.message };
            setDone(d);
            if (stateRef.current.cur === id) setCur(next(id, d));
          }
        }
        return;
      }
      // 화면에는 서버가 확정한 문구(실제로 나갈 글)를 보여 준다.
      const confirmed = res.message;
      setSent({ id, text: confirmed, saved: true });
      setQs((q) => ({ ...q, [id]: "queued" }));
      onChanged?.();
      setTimeout(() => {
        const d = { ...stateRef.current.done, [id]: confirmed };
        setDone(d);
        setSent(null);
        if (stateRef.current.cur === id) setCur(next(id, d));
      }, SENT_PAUSE_MS);
    });
  };
  const resend = async (id: string) => {
    const err = await resendAfterCheck(id);
    if (err) { setQerr((e) => ({ ...e, [id]: err })); return; }
    setQerr((e) => { const n = { ...e }; delete n[id]; return n; });
    setQs((q) => ({ ...q, [id]: "queued" }));
    setDone((d) => ({ ...d, [id]: "다시 보냄" }));
    onChanged?.();
  };
  const check = async (id: string) => {
    const item = await checkOnInstagram(id);
    if (typeof item === "string") { setQerr((e) => ({ ...e, [id]: item })); return; }
    setQs((q) => ({ ...q, [id]: item.status }));
    if (item.status === "sent") {
      setQerr((e) => { const n = { ...e }; delete n[id]; return n; });
      setDone((d) => ({ ...d, [id]: item.message }));
      onChanged?.();
    } else {
      const err = errorOf(item);
      if (err) setQerr((e) => ({ ...e, [id]: err }));
    }
  };
  const skip = () => {
    if (!c || sent) return;
    onSkip(c.id);
    const d = { ...done, [c.id]: "건너뜀" };
    setDone(d);
    setQs((q) => ({ ...q, [c.id]: "skipped" }));
    setCur(next(c.id, d));
  };

  return (
    <div className="relative">
      <div className="flex h-[var(--inbox-h,100dvh)] min-h-[560px] overflow-hidden bg-white">
        <div className="flex w-[360px] shrink-0 flex-col shadow-[1px_0_0_0_rgba(10,10,10,0.08)]">
          <div className="flex h-[60px] shrink-0 items-center gap-1 pl-4 pr-2">
            <span className="text-[16px] font-bold text-neutral-950">댓글</span>
            <span className="ml-1.5 text-[13px] font-semibold text-neutral-500"><NumberFlow value={left} /></span>
            <span className="ml-auto" />
            <button type="button" onClick={onOpenDrafts} disabled={!!draftProgress}
              className="mr-1 inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors hover:bg-neutral-950/[0.05] disabled:text-neutral-500" style={draftProgress ? undefined : { color: ACCENT }}>
              <Icon name="sparkles" className={`size-3.5 ${draftProgress ? "animate-pulse" : ""}`} />
              {draftProgress ? `초안 ${draftProgress}` : "초안 만들기"}
            </button>
            <button type="button" title="새로고침" onClick={onSync} disabled={syncing} className={ICON_BTN}><Icon name="refresh" className={`size-4 ${syncing ? "animate-spin" : ""}`} /></button>
            <SortMenu value={sort} onChange={setSort} />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
            {order.map((x) => (
              <ActivityRow key={x.id} c={x} on={x.id === cur} done={settled(x)} status={qs[x.id]} photo={discovery[x.username]?.profilePictureUrl} onClick={() => setCur(x.id)} />
            ))}
          </ul>
        </div>
        {c ? (
          <PostView key={c.id} c={c} media={media[c.mediaId]} photo={discovery[c.username]?.profilePictureUrl}
            text={textOf(c)} onText={(v) => setTexts((t) => ({ ...t, [c.id]: v }))} tone={tones[c.id] ?? 0} onTone={tone} toneLocked={c.id in fixed}
            sent={sent?.id === c.id ? sent : null} error={qerr[c.id] ?? ""} enterHeld={enterHeld}
            locked={qs[c.id] === "unknown" ? "이미 발송을 시도했어요. 중복 발송을 막으려고 다시 보내기를 잠갔어요." : ""}
            onSend={send} onSkip={skip} onResend={qs[c.id] === "unknown" ? () => void resend(c.id) : null}
            onCheck={qs[c.id] === "unknown" ? () => void check(c.id) : null} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[14px] text-neutral-500">{left ? "왼쪽에서 댓글을 고르세요" : "다 답했어요"}</div>
        )}
      </div>
    </div>
  );
}
