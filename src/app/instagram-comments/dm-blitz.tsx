"use client";

// DM 쳐내기 — "사람 줄 + 대화 카드".
// 왼쪽 = 사람 줄(지금 보낼 수 있는 사람 → 맨 아래 접힌 "앱에서"), 오른쪽 = 대화 카드.
// 열자마자: ① 질문 찾기(LLM 1회) ② 질문이 있으면 팝업으로 한 번에 묻고, 답(또는 건너뛰기) 뒤에 전체 초안을 쓴다.
//   질문이 없으면 바로 전체 초안. 초안은 동시에 3개씩.
// ⏎ = 서버 발송 대기줄에 담고 즉시 다음 사람. 간격은 대기줄이 지킨다(화면에 초를 보이지 않는다).
// 24시간 지난 대화는 API 발송 불가 → ⏎ = 초안 복사 + 인스타 앱 대화 열기.
// AI(claude/codex)가 없으면 질문·초안 없이 직접 쓰는 화면으로 그대로 동작한다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { motion } from "motion/react";
import { springs } from "@/components/motion/presets";
import type { DmStyle } from "@/lib/instagram-dm/dm-style";
import { Avatar, ChatCard, ACCENT, QuestionsModal, relativeTime, splitThread, type BlitzBasis, type BlitzQuestion, type Conversation } from "./dm-blitz-card";

type Handled = "sent" | "copied" | "skipped";
type QueueView = { status: string; stopReason: string | null; conversations: Record<string, { status: "pending" | "sent" | "failed"; error?: string }>; style?: DmStyle };

const DRAFT_CONCURRENCY = 3;

class AiOffError extends Error {}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: string; aiUnavailable?: boolean };
  if (json.aiUnavailable) throw new AiOffError(json.error);
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** 한 번에 N개씩만 돌리는 작은 풀 */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  const rest = [...items];
  await Promise.all(Array.from({ length: Math.min(n, rest.length) }, async () => { for (let t = rest.shift(); t !== undefined; t = rest.shift()) await fn(t); }));
}

const DRAFT_CACHE_KEY = "dm-blitz-drafts:v1";
type CachedDraft = { last: string; versions: [string, string]; ver: number; text: string; basis: BlitzBasis; edited: boolean };

function lastMessageId(c: Conversation): string {
  return c.messages[c.messages.length - 1]?.id ?? "";
}

function loadDraftCache(): Record<string, CachedDraft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_CACHE_KEY) ?? "{}") as Record<string, CachedDraft>;
  } catch {
    return {};
  }
}

function saveDraftCache(cache: Record<string, CachedDraft>) {
  try {
    localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 저장 못 해도 화면은 그대로 동작한다 */
  }
}

/** 초안 2버전(짧게/나눠서). texts = 화면에 보이는 버전의 글, versions = 두 버전 원본(고친 내용 포함). */
function useBlitzDrafts(pending: Conversation[]) {
  // 새로고침해도 초안 2벌·고친 글이 남게 브라우저에 둔다. 상대가 새 메시지를 보냈으면 그 대화 저장본은 버린다.
  // (이 훅은 데이터를 받은 뒤 브라우저에서만 그려져서 첫 렌더에 바로 읽어도 된다)
  const [restored] = useState(() => {
    const cache = loadDraftCache();
    return Object.fromEntries(pending.filter((c) => cache[c.id]?.last === lastMessageId(c)).map((c) => [c.id, cache[c.id]]));
  });
  const pick = <T,>(f: (e: CachedDraft) => T) => Object.fromEntries(Object.entries(restored).map(([id, e]) => [id, f(e)]));
  const [texts, setTexts] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(pending.map((c) => [c.id, c.draft])), ...pick((e) => e.text) }));
  const [versions, setVersions] = useState<Record<string, [string, string]>>(() => pick((e) => e.versions));
  const [ver, setVer] = useState<Record<string, number>>(() => pick((e) => e.ver));
  const [basis, setBasis] = useState<Record<string, BlitzBasis>>(() => pick((e) => e.basis));
  const [drafting, setDrafting] = useState<Set<string>>(new Set());
  // AI 가 없으면 한 번 알고 나서 더 부르지 않는다 (직접 쓰기)
  const [aiOff, setAiOff] = useState(false);
  const aiOffRef = useRef(false);
  const edited = useRef(new Set(Object.keys(restored).filter((id) => restored[id].edited)));

  useEffect(() => {
    const out: Record<string, CachedDraft> = {};
    for (const c of pending) {
      if (!versions[c.id] || !basis[c.id]) continue;
      out[c.id] = { last: lastMessageId(c), versions: versions[c.id], ver: ver[c.id] ?? 0, text: texts[c.id] ?? "", basis: basis[c.id], edited: edited.current.has(c.id) };
    }
    saveDraftCache(out);
  }, [pending, versions, ver, basis, texts]);

  const draft = useCallback(async (id: string, answer?: string) => {
    if (aiOffRef.current) return;
    setDrafting((s) => new Set(s).add(id));
    try {
      const out = await postJson<{ versions: [string[], string[]]; basis: BlitzBasis }>("/api/instagram/dm/blitz/draft", { conversationId: id, answer });
      setBasis((b) => ({ ...b, [id]: out.basis }));
      // 이미 고치고 있던 초안은 덮지 않는다 (질문에 답해 다시 쓴 건 덮는다)
      if (answer || !edited.current.has(id)) {
        const v: [string, string] = [out.versions[0].join("\n"), out.versions[1].join("\n")];
        setVersions((x) => ({ ...x, [id]: v }));
        setVer((x) => ({ ...x, [id]: 0 }));
        setTexts((t) => ({ ...t, [id]: v[0] }));
      }
    } catch (e) {
      // 실패하면 기존 초안 그대로 — 직접 쓰면 된다
      if (e instanceof AiOffError) { aiOffRef.current = true; setAiOff(true); }
    } finally {
      setDrafting((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, []);

  const edit = (id: string, v: string) => { edited.current.add(id); setTexts((t) => ({ ...t, [id]: v })); };
  /** Tab: 지금 글을 그 버전에 남겨 두고 다른 버전으로 */
  const toggle = (id: string) => {
    const pair = versions[id];
    if (!pair) return;
    const cur = ver[id] ?? 0;
    const next = cur === 0 ? 1 : 0;
    const kept: [string, string] = cur === 0 ? [texts[id] ?? "", pair[1]] : [pair[0], texts[id] ?? ""];
    setVersions((x) => ({ ...x, [id]: kept }));
    setVer((x) => ({ ...x, [id]: next }));
    setTexts((t) => ({ ...t, [id]: kept[next] }));
  };
  const markAiOff = useCallback(() => { aiOffRef.current = true; setAiOff(true); }, []);
  return { texts, basis, drafting, draft, edit, toggle, aiOff, markAiOff, verOf: (id: string) => (versions[id] ? ver[id] ?? 0 : null) };
}

function useBlitzQueue(active: boolean) {
  const [queue, setQueue] = useState<QueueView | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/instagram/dm/blitz/queue");
    if (res.ok) setQueue((await res.json()) as QueueView);
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = active ? setInterval(() => void load(), 3_000) : undefined;
    return () => { clearTimeout(first); clearInterval(t); };
  }, [active, load]);
  return { queue, setQueue, reload: load };
}

function PersonRow({ c, on, mark, done, onClick }: { c: Conversation; on: boolean; mark: React.ReactNode; done: boolean; onClick: () => void }) {
  const last = splitThread(c.messages).burst.at(-1);
  return (
    <motion.li layout transition={springs.smooth}>
      <button type="button" onClick={onClick}
        className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${on ? "bg-neutral-950/[0.06]" : "hover:bg-neutral-950/[0.03]"}`}>
        <Avatar username={c.peerUsername} size="lg" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] text-neutral-950 ${done ? "" : "font-semibold"}`}>{c.peerUsername}</span>
          <span className={`flex text-[13px] ${done ? "text-neutral-500" : "font-semibold text-neutral-950"}`}>
            <span className="min-w-0 truncate">{last?.text || c.lastText}</span>
            <span className="shrink-0 font-normal text-neutral-500">&nbsp;· {relativeTime(c.updatedTime).replace(/ 전$/, "")}</span>
          </span>
        </span>
        {mark}
      </button>
    </motion.li>
  );
}

function RowMark({ handled, queued, asked, reason }: { handled?: Handled; queued?: { status: string; error?: string }; asked: boolean; reason?: string }) {
  if (reason && !handled) return <span className="shrink-0 text-[11px] text-neutral-400">{reason}</span>;
  if (queued?.status === "failed") return <span title={queued.error} className="text-[11px] font-semibold text-rose-600">!</span>;
  if (handled === "sent" || handled === "copied") return <span className="text-[11px] text-neutral-400">{handled === "sent" ? "보냄" : "복사함"}</span>;
  if (asked) return <span className="text-[12px] font-semibold text-amber-600">?</span>;
  return <span className="size-2 shrink-0 rounded-full" style={{ background: ACCENT }} />;
}

function StoppedBar({ queue, onResume }: { queue: QueueView | null; onResume: () => void }) {
  if (queue?.status !== "stopped") return null;
  return (
    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 shadow-sm ring-1 ring-neutral-950/5">
      <span className="min-w-0 flex-1 truncate">발송 멈춤 · {queue.stopReason}</span>
      <button type="button" onClick={onResume} className="shrink-0 rounded-md bg-white px-2 py-0.5 font-medium ring-1 ring-neutral-950/5">다시 시작</button>
    </div>
  );
}

/** 받은함 맨 위 한 줄: 전체 초안이 어디까지 왔는지 */
function DraftStatusRow({ phase }: { phase: QuestionPhase }) {
  const label = phase === "asking" ? "초안 전에 물어볼 것 찾는 중" : phase === "open" ? "질문에 답하면 전체 초안을 써요" : phase === "drafting" ? "전체 초안 쓰는 중" : null;
  if (!label) return null;
  return <li className="px-4 py-1.5 text-[12px] text-neutral-500"><span className={phase === "open" ? "" : "animate-pulse"}>{label}</span></li>;
}

function AppFold({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <li className="pt-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-1 px-4 py-1.5 text-[13px] font-semibold text-neutral-500 hover:text-neutral-800">
        24시간 지남 · 앱에서 {count}
        <Icon name="chevron-down" className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
    </li>
  );
}

function DoneCard({ count, left }: { count: number; left: number }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1">
      {count ? <span className="text-[34px] font-semibold tabular-nums text-neutral-950">{count}</span> : null}
      <span className="text-[14px] text-neutral-500">{left ? "왼쪽에서 대화를 고르세요" : "다 답했어요"}</span>
    </div>
  );
}

/**
 * 전체 초안 전에 질문 팝업. asking = 질문 찾는 중, open = 팝업이 떠 있음, drafting = 전체 초안 쓰는 중, done = 끝.
 * 질문이 없으면 팝업 없이 바로 전체 초안. 팝업은 답하고 만들기 / 건너뛰고 만들기 둘 다 전체 초안으로 간다.
 */
type QuestionPhase = "asking" | "open" | "drafting" | "done";

function useBlitzQuestions(answerable: Conversation[], draft: (id: string, answer?: string) => Promise<void>, onAiOff: () => void) {
  const [questions, setQuestions] = useState<BlitzQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<QuestionPhase>(answerable.length ? "asking" : "done");
  const started = useRef(false);

  const draftAll = useCallback(async (ans: Record<string, string>) => {
    setPhase("drafting");
    await pool(answerable.map((c) => c.id), DRAFT_CONCURRENCY, (id) => draft(id, ans[id]?.trim() || undefined));
    setPhase("done");
  }, [answerable, draft]);

  useEffect(() => {
    if (started.current || answerable.length === 0) return;
    started.current = true;
    void (async () => {
      let qs: BlitzQuestion[] = [];
      try {
        const out = await postJson<{ questions: BlitzQuestion[]; ai?: boolean }>("/api/instagram/dm/blitz/questions", { conversationIds: answerable.map((c) => c.id) });
        qs = out.questions;
        if (out.ai === false) onAiOff();
      } catch (e) {
        if (e instanceof AiOffError) onAiOff();
      }
      setQuestions(qs);
      if (qs.length) setPhase("open");
      else await draftAll({});
    })();
  }, [answerable, draftAll, onAiOff]);

  return {
    questions, answers, setAnswers, phase,
    submit: () => void draftAll(answers),
    skip: () => void draftAll({}),
  };
}

const ICON_BTN = "flex size-8 items-center justify-center rounded-full text-neutral-900 transition-colors hover:bg-neutral-950/[0.05] active:scale-[0.96]";

/** 인스타 받은함 머리: 제목 · 남은 수 · 아이콘 3개(새로고침 · 전체 대화 · 인스타에서 열기) */
function InboxHeader({ left, bar }: { left: number; bar: BlitzBar }) {
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-1 pl-4 pr-2">
      <span className="text-[16px] font-bold text-neutral-950">메시지</span>
      <span className="ml-1.5 text-[13px] font-semibold tabular-nums text-neutral-500">{left}</span>
      <span className="ml-auto" />
      <button type="button" title="새로고침" onClick={bar.onSync} disabled={bar.syncing} className={ICON_BTN}>
        <Icon name="refresh" className={`size-4 ${bar.syncing ? "animate-spin" : ""}`} />
      </button>
      <a href="https://www.instagram.com/direct/inbox/" target="_blank" rel="noreferrer" title="인스타에서 열기" className={ICON_BTN}>
        <Icon name="external" className="size-4" />
      </a>
    </div>
  );
}

/** 인스타 '기본 | 일반' 같은 글자 탭 */
function InboxTabs({ tab, onTab, reply, done }: { tab: "reply" | "done"; onTab: (t: "reply" | "done") => void; reply: number; done: number }) {
  const tabs = [{ id: "reply" as const, label: "답장", n: reply }, { id: "done" as const, label: "정리", n: done }];
  return (
    <div className="flex shrink-0 px-4 shadow-[0_-1px_0_0_rgba(10,10,10,0.08)_inset]">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onTab(t.id)}
          className={`relative flex-1 py-2.5 text-[14px] font-semibold transition-colors ${tab === t.id ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-700"}`}>
          {t.label} <span className="font-normal">{t.n}</span>
          {tab === t.id ? <motion.span layoutId="dm-inbox-tab" transition={springs.snappy} className="absolute inset-x-0 bottom-0 h-px bg-neutral-950" /> : null}
        </button>
      ))}
    </div>
  );
}

/** 정리 칸: 글로 답하지 않아도 되는 대화. 이유를 한 단어로, 한 번에 치운다. */
function DoneList({ list, row, onClear }: { list: Conversation[]; row: (c: Conversation) => React.ReactNode; onClear: () => void }) {
  if (!list.length) return <div className="flex flex-1 items-center justify-center text-[13px] text-neutral-400">정리할 대화가 없어요</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 py-2 text-[12px] text-neutral-500">
        <span>마무리 인사·스토리 언급·이모지</span>
        <button type="button" onClick={onClear} className="font-semibold active:scale-[0.96]" style={{ color: ACCENT }}>모두 정리</button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">{list.map(row)}</ul>
    </div>
  );
}

function PeopleList(p: {
  answerable: Conversation[]; appOnly: Conversation[]; appOpen: boolean; cur: string | null; handled: Record<string, Handled>;
  queue: QueueView | null; askedIds: Set<string>; bar: BlitzBar; phase: QuestionPhase;
  onPick: (c: Conversation) => void; onToggleApp: () => void;
  tab: "reply" | "done"; onTab: (t: "reply" | "done") => void; doneList: Conversation[]; onClearDone: () => void;
}) {
  const row = (c: Conversation) => (
    <PersonRow key={c.id} c={c} on={c.id === p.cur} done={!!p.handled[c.id]} onClick={() => p.onPick(c)}
      mark={<RowMark handled={p.handled[c.id]} queued={p.queue?.conversations[c.id]} asked={p.askedIds.has(c.id)} reason={c.triage === "done" ? c.triageReason : undefined} />} />
  );
  // 답한 대화는 아래로 — 남은 사람이 위에 모이게
  const byDone = (list: Conversation[]) => [...list].sort((a, b) => Number(!!p.handled[a.id]) - Number(!!p.handled[b.id]));
  const left = [...p.answerable, ...p.appOnly].filter((c) => !p.handled[c.id]).length;
  const doneLeft = p.doneList.filter((c) => !p.handled[c.id]);
  return (
    <div className="flex w-[320px] shrink-0 flex-col shadow-[1px_0_0_0_rgba(10,10,10,0.08)]">
      <InboxHeader left={left} bar={p.bar} />
      <InboxTabs tab={p.tab} onTab={p.onTab} reply={left} done={doneLeft.length} />
      {p.tab === "done" ? <DoneList list={doneLeft} row={row} onClear={p.onClearDone} /> : (
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
        <DraftStatusRow phase={p.phase} />
        {byDone(p.answerable).map(row)}
        {p.appOnly.length ? <AppFold count={p.appOnly.length} open={p.appOpen} onToggle={p.onToggleApp} /> : null}
        {p.appOpen ? byDone(p.appOnly).map(row) : null}
      </ul>
      )}
    </div>
  );
}

/** 방금 처리한 사람 다음으로 열 사람 */
function nextAfter(order: Conversation[], id: string, handled: Record<string, Handled>, appOpen: boolean): string | null {
  const k = order.findIndex((c) => c.id === id);
  return [...order.slice(k + 1), ...order.slice(0, k)].find((c) => !handled[c.id] && c.id !== id && (c.canReply || appOpen))?.id ?? null;
}

/**
 * PC 웹에서 그 사람에게 DM 을 여는 주소. ig.me/m/<아이디> 는 휴대폰 앱 전용이라 웹에선 instagram.com/m/<아이디>
 * "페이지를 사용할 수 없습니다"로 끝난다 (10-06 실측). 웹 대화방 번호는 Graph API 대화 id 와 달라 원장에 없다 →
 * 프로필을 열고 [메시지 보내기] 한 번으로 그 대화방에 들어간다.
 */
export function webDmUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

/** 24시간 안: 서버 대기줄에 담는다. 밖: 초안 복사 + 인스타 웹에서 그 사람 열기. 담기 실패면 false. */
async function sendOrCopy(c: Conversation, bubbles: string[], setQueue: (q: QueueView) => void): Promise<boolean> {
  if (!c.canReply) {
    void navigator.clipboard?.writeText(bubbles.join("\n"));
    window.open(webDmUrl(c.peerUsername), "_blank", "noopener");
    return true;
  }
  try {
    setQueue(await postJson<QueueView>("/api/instagram/dm/blitz/queue", { conversationId: c.id, bubbles }));
    return true;
  } catch {
    return false;
  }
}

function useBlitzSession(live: Conversation[]) {
  // 연 순간의 목록을 붙잡는다 — 보낸 대화가 재조회로 사라져도 줄과 ✓ 가 흔들리지 않게
  const [pending] = useState(live);
  // 두 칸: 답장(글로 답할 것) / 정리(마무리 인사·스토리 언급·이모지). 초안·질문은 답장 칸만.
  const replyList = useMemo(() => pending.filter((c) => c.triage !== "done"), [pending]);
  const doneList = useMemo(() => pending.filter((c) => c.triage === "done"), [pending]);
  const answerable = useMemo(() => replyList.filter((c) => c.canReply), [replyList]);
  const appOnly = useMemo(() => replyList.filter((c) => !c.canReply), [replyList]);
  const [tab, setTab] = useState<"reply" | "done">("reply");
  const byId = useMemo(() => Object.fromEntries(pending.map((c) => [c.id, c])), [pending]);
  const drafts = useBlitzDrafts(pending);
  const { draft } = drafts;
  const [handled, setHandled] = useState<Record<string, Handled>>({});
  // 지금 보낼 수 있는 대화가 없으면 빈 화면 대신 첫 대화(앱에서 답할 것)를 바로 연다
  const [cur, setCur] = useState<string | null>(answerable[0]?.id ?? appOnly[0]?.id ?? null);
  const [appOpen, setAppOpen] = useState(answerable.length === 0);
  const { queue, setQueue, reload } = useBlitzQueue(Object.values(handled).includes("sent"));
  const q = useBlitzQuestions(answerable, draft, drafts.markAiOff);
  const openList = [...answerable, ...(appOpen ? appOnly : [])].filter((c) => !handled[c.id]);
  // 열린 대화에 초안 2버전(짧게/나눠서)이 없으면 그때 쓴다. 저장된 초안 1벌만 있는 대화도
  // 탭으로 바꿔 볼 수 있게 (83건을 미리 다 쓰지 않게 열릴 때만). 실패하면 같은 대화는 다시 안 쏜다.
  const { basis: draftBasis, drafting: draftBusy } = drafts;
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const c = cur ? pending.find((x) => x.id === cur) : undefined;
    // 전체 초안이 도는 동안(팝업 포함)은 기다린다 — 같은 대화를 두 번 쓰지 않게
    if (q.phase !== "done") return;
    if (!c || draftBasis[c.id] || draftBusy.has(c.id) || tried.current.has(c.id)) return;
    const t = setTimeout(() => { tried.current.add(c.id); void draft(c.id); }, 0);
    return () => clearTimeout(t);
  }, [cur, pending, draftBasis, draftBusy, draft, q.phase]);

  const finish = (id: string, how: Handled) => {
    // Esc(넘기기) = 정리: 원장에 '건너뜀'으로 남겨 다음에 다시 뜨지 않게 (≡ 전체 대화의 건너뜀에서 되돌릴 수 있다)
    if (how === "skipped") void fetch("/api/instagram/dm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, skipped: true }) });
    setHandled((h) => ({ ...h, [id]: how }));
    setCur(nextAfter([...answerable, ...appOnly], id, handled, appOpen));
  };

  const send = async (c: Conversation, bubbles: string[]) => {
    finish(c.id, c.canReply ? "sent" : "copied");
    const ok = await sendOrCopy(c, bubbles, setQueue);
    if (!ok) { setHandled((h) => { const n = { ...h }; delete n[c.id]; return n; }); void reload(); } // 담기 실패 → 다시 줄에
  };

  /** 정리 칸 전부를 건너뜀으로 — 한 번에 */
  const clearDone = async () => {
    const ids = doneList.filter((c) => !handled[c.id]).map((c) => c.id);
    if (!ids.length) return;
    setHandled((h) => ({ ...h, ...Object.fromEntries(ids.map((id) => [id, "skipped" as const])) }));
    await fetch("/api/instagram/dm", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationIds: ids, skipped: true }) });
  };

  return { pending: { answerable, appOnly, byId, doneList }, tab, setTab, clearDone, drafts, handled, cur, setCur, appOpen, setAppOpen, queue, setQueue,
    q, openList, finish, send };
}

/** 받은함 머리의 아이콘이 부르는 것 */
interface BlitzBar {
  syncing: boolean;
  onSync: () => void;
}

/** 인스타 웹 Direct 처럼 생긴 쳐내기 본체. 연 순간의 답장 대기 목록을 붙잡고 끝까지 간다. */
function BlitzSession({ pending: live, bar }: { pending: Conversation[]; bar: BlitzBar }) {
  const b = useBlitzSession(live);
  const { answerable, appOnly, byId, doneList } = b.pending;
  const { texts, basis, drafting, edit, toggle, verOf, aiOff } = b.drafts;
  const { cur, setCur, handled, queue, setQueue, finish, send, openList, appOpen, setAppOpen, q } = b;
  const current = byId[String(cur)] ?? null;
  const askedIds = new Set(q.phase === "done" ? [] : (q.questions ?? []).map((x) => x.conversationId));
  const cardText = current ? texts[current.id] ?? "" : "";
  const cardBasis = current ? basis[current.id] ?? null : null;
  const people = { answerable, appOnly, appOpen, cur, handled, queue, askedIds, bar, phase: aiOff ? "done" as const : q.phase };

  return (
    <div className="relative h-full">
      <StoppedBar queue={queue} onResume={async () => setQueue(await postJson<QueueView>("/api/instagram/dm/blitz/queue", { resume: true }))} />
      <div className="flex h-full overflow-hidden bg-white">
      <PeopleList {...people}
        onPick={(c) => setCur(c.id)} onToggleApp={() => setAppOpen((v) => !v)}
        tab={b.tab} onTab={b.setTab} doneList={doneList} onClearDone={() => void b.clearDone()} />
      <div className="flex min-w-0 flex-1">
        {current ? (
          <ChatCard key={current.id} convo={current} text={cardText} onText={(v) => edit(current.id, v)}
            basis={cardBasis} drafting={drafting.has(current.id)} appOnly={!current.canReply}
            onSend={(b) => void send(current, b)} onSkip={() => finish(current.id, "skipped")}
            version={verOf(current.id)} onToggleVersion={() => toggle(current.id)}
            style={queue?.style ?? null} aiOff={aiOff} />
        ) : (
          <DoneCard count={Object.values(handled).filter((h) => h !== "skipped").length} left={openList.length} />
        )}
      </div>
      </div>
      {q.phase === "open" && !aiOff && q.questions ? (
        <QuestionsModal questions={q.questions} total={answerable.length} convos={byId} answers={q.answers}
          onAnswer={(id, v) => q.setAnswers((a) => ({ ...a, [id]: v }))} onDone={q.submit} onSkip={q.skip} />
      ) : null}
    </div>
  );
}

/**
 * DM 쳐내기 탭. props 없음 — 스스로 /api/instagram/dm 을 읽고, 새로고침 버튼은 동기화 뒤 새 목록으로 다시 연다.
 * 연결된 계정·AI 유무와 상관없이 동작한다 (AI 가 없으면 직접 쓰기).
 */
export function DmBlitz() {
  const [pending, setPending] = useState<Conversation[] | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [round, setRound] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/instagram/dm");
      if (!res.ok) throw new Error();
      const v = (await res.json()) as { pending: Conversation[] };
      setPending(v.pending);
      setError("");
      setRound((n) => n + 1);
    } catch {
      setError("DM 을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/instagram/dm/sync", { method: "POST" });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "동기화 실패");
      await load();
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const bar = useMemo(() => ({ syncing, onSync: () => void onSync() }), [syncing, onSync]);

  return (
    <div className="relative h-[var(--inbox-h,100dvh)]">
      {error ? <p className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 shadow-sm">{error}</p> : null}
      {pending === null ? (
        <div className="flex h-full items-center justify-center text-[14px] text-neutral-400"><span className="animate-pulse">DM 불러오는 중</span></div>
      ) : (
        <BlitzSession key={round} pending={pending} bar={bar} />
      )}
    </div>
  );
}
