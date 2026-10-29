"use client";

// DM 쳐내기 대화 칸 — "인스타 그대로 + 초안", 오른쪽 패널 없음.
// 인스타 웹 Direct 생김새(회색/파랑 말풍선 · 둥근 입력칸 · "보내기")에 초안과 'AI 초안' 줄만 얹는다.
// 키: ⏎ 보내고 다음 · ⇧⏎ 말풍선 나누기 · Esc 넘기기. 발송은 서버 대기줄이 간격을 지켜 알아서 내보낸다.
// 말풍선·버튼 색은 앱 주 색(--color-primary-700, 잉크 네이비)을 쓴다. Figma primary/700 과 같다.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/icon";
import { springs } from "@/components/motion/presets";
import type { DmStyle } from "@/lib/instagram-dm/dm-style";
import type { DmTriage, DmTriageReason } from "@/lib/instagram-dm/triage";

export interface DmMessage {
  id: string;
  fromMe: boolean;
  text: string;
  createdTime: string;
  story?: { kind: "mention" | "reply_to"; link: string };
  attachments?: { imageUrl?: string; videoUrl?: string; fileUrl?: string }[];
}

/** GET /api/instagram/dm 의 대화 한 건 중 쳐내기가 쓰는 칸 */
export interface Conversation {
  id: string;
  peerUsername: string;
  profileUrl: string | null;
  updatedTime: string;
  lastText: string;
  messages: DmMessage[];
  canReply: boolean;
  draft: string;
  triage: DmTriage;
  triageReason: DmTriageReason;
}

const AVATAR_COLORS = ["bg-emerald-100 text-emerald-700", "bg-sky-100 text-sky-700", "bg-amber-100 text-amber-700", "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700"];

function avatarColor(username: string) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** 이니셜 아바타 (프로필 사진 조회는 이 앱에 없다) */
export function Avatar({ username, size = "md" }: { username: string; size?: "sm" | "lg" | "md" }) {
  const cls = size === "lg" ? "size-10 text-sm" : size === "sm" ? "size-7 text-[11px]" : "size-8 text-xs";
  const label = username.replace(/^\(|\)$/g, "").slice(0, 1).toUpperCase() || "?";
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${avatarColor(username)} ${cls}`}>{label}</span>;
}

export function relativeTime(iso: string): string {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(min)) return "";
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export const ACCENT = "var(--color-primary-700)";
/** 보낸 말풍선과 "보냄"을 보여 주는 시간. 그 뒤 다음 대화로 넘어간다. */
const SENT_PAUSE_MS = 600;

export interface BlitzBasis {
  post: { text: string; url: string } | null;
  past: string[];
  pastKind: "peer" | "general";
  answer: string | null;
}

export interface BlitzQuestion {
  conversationId: string;
  question: string;
  hint: string;
}

const messageText = (m: DmMessage) => m.text || (m.story ? (m.story.kind === "mention" ? "(스토리에서 나를 언급)" : "(내 스토리에 답장)") : "(사진)");
const bubblesOf = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

/** 내 마지막 말 이후 상대가 연달아 보낸 말 + 그 앞 내 마지막 말 */
export function splitThread(messages: DmMessage[]): { mine: string; burst: DmMessage[] } {
  const burst: DmMessage[] = [];
  let k = messages.length - 1;
  for (; k >= 0 && !messages[k].fromMe; k--) burst.unshift(messages[k]);
  for (; k >= 0; k--) if (messages[k].fromMe && messages[k].text) return { mine: messages[k].text, burst };
  return { mine: "", burst };
}

/** 인스타처럼 연속 말풍선은 모서리를 이어 붙인다 */
function corner(side: "in" | "out", k: number, n: number): string {
  const tail = side === "in" ? ["rounded-tl-[6px]", "rounded-bl-[6px]"] : ["rounded-tr-[6px]", "rounded-br-[6px]"];
  return ["rounded-[22px]", k > 0 ? tail[0] : "", k < n - 1 ? tail[1] : ""].join(" ");
}

/** 예전에 이 사람에게 보낸 답장으로 존댓말/반말. 기록이 없으면 존댓말 기본. */
function tone(basis: BlitzBasis | null): { label: string; why: string } | null {
  if (!basis) return null;
  if (basis.pastKind !== "peer" || !basis.past.length) return { label: "존댓말", why: "처음 답장 · 기본값" };
  // 끝의 이모지·기호·ㅎㅎ 를 걷어낸 마지막 글자로 본다 (":)" "^^" 로 끝나는 답장이 많다)
  const polite = basis.past.filter((p) => /(요|용|니다|죠)$/.test(p.replace(/[^가-힣]+$/u, "").replace(/[ㅎㅋㅠㅜ]+$/u, ""))).length;
  return { label: polite * 2 >= basis.past.length ? "존댓말" : "반말", why: `예전 답장 ${basis.past.length}개 기준` };
}

/** 문장 끝(?! . ~ ㅎㅎ ㅋㅋ ㅠㅠ)에서 나눈다. 최대 3개. */
function split(text: string): string {
  const parts = text.replace(/\n/g, " ").split(/(?<=[?!.~]|ㅎㅎ|ㅋㅋ|ㅠㅠ)\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  return [parts[0], parts[1], parts.slice(2).join(" ")].filter(Boolean).join("\n");
}

type Ref = { id: string; label: string; body: string[]; href?: string };

function refsOf(basis: BlitzBasis | null): Ref[] {
  if (!basis) return [];
  const out: Ref[] = [];
  if (basis.answer) out.push({ id: "ans", label: "내 답", body: [basis.answer] });
  if (basis.post) out.push({ id: "post", label: "최근 글", body: [basis.post.text], href: basis.post.url });
  if (basis.past.length) out.push({ id: "past", label: basis.pastKind === "peer" ? `예전 답장 ${basis.past.length}` : "말투 본보기", body: basis.past });
  return out;
}

/** 입력칸 아래 회색 한 줄 (인스타 입력칸 아래엔 원래 아무것도 없어서, 눈에 덜 띄게):
 *  [짧게|나눠서] · AI 초안 · 존댓말 · 근거(누르면 펼침) · 3개 이상일 때만 경고 · 하나로/나누기 */
function AiStrip({ text, basis, style, onText, version, onToggle }: { text: string; basis: BlitzBasis | null; style: DmStyle | null; onText: (v: string) => void; version: number | null; onToggle: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const n = bubblesOf(text).length;
  const t = tone(basis);
  const refs = refsOf(basis);
  const cur = refs.find((r) => r.id === open);
  if (!n) return null;
  return (
    <div className="mt-2 px-1 text-[12px] text-neutral-500">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <VersionTabs version={version} onToggle={onToggle} />
        {basis ? <span>AI 초안</span> : null}
        {t ? <span title={t.why}>· {t.label}</span> : null}
        {refs.map((r) => (
          <button key={r.id} type="button" onClick={() => setOpen(open === r.id ? null : r.id)}
            className={`transition-colors hover:text-neutral-900 ${open === r.id ? "font-semibold text-neutral-900" : ""}`}>
            · {r.label}
          </button>
        ))}
        {style && n > style.usualMaxBubbles ? (
          <span className="text-amber-700" title={style.measured ? `내 답장 ${style.replies}번 중 ${style.parts.one + style.parts.two}%가 1~2개` : "답장 기록이 적어 기본값으로 봐요"}>· 말풍선 {n}개, 평소보다 많음</span>
        ) : null}
        <button type="button" onClick={() => onText(n > 1 ? bubblesOf(text).join(" ") : split(text))}
          className="ml-auto font-medium text-neutral-500 transition-colors hover:text-neutral-900 active:scale-[0.96]">
          {n > 1 ? "하나로" : "나누기"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {cur ? (
          <motion.ul key={cur.id} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={springs.snappy}
            className="mt-1.5 max-h-28 space-y-1 overflow-y-auto rounded-xl bg-neutral-50 p-2.5 leading-snug text-neutral-600">
            {cur.body.map((b, k) => <li key={k}>{b}</li>)}
            {cur.href ? <li><a href={cur.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-neutral-400 hover:text-neutral-700">원문 <Icon name="external" className="size-3" /></a></li> : null}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** 인스타처럼 대화 사이 날짜 구분 ("10월 3일 오후 3:12") */
function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Thread({ convo, sent }: { convo: Conversation; sent: string[] | null }) {
  const reduce = useReducedMotion();
  const { mine, burst } = splitThread(convo.messages);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-[2px] overflow-y-auto px-4 py-3">
      {mine ? (
        <div className="mb-3 flex justify-end pl-16">
          <p className="whitespace-pre-wrap rounded-[22px] px-3 py-2 text-[15px] leading-snug text-white" style={{ background: ACCENT }}>{mine}</p>
        </div>
      ) : null}
      {burst[0] ? <p className="mb-2 text-center text-[12px] text-neutral-500">{stamp(burst[0].createdTime)}</p> : null}
      {burst.map((m, k) => (
        <div key={m.id} className="flex items-end gap-2 pr-16">
          <span className="w-7 shrink-0">{k === burst.length - 1 ? <Avatar username={convo.peerUsername} size="sm" /> : null}</span>
          <p className={`whitespace-pre-wrap bg-[#EFEFEF] px-3 py-2 text-[15px] leading-snug text-neutral-950 ${corner("in", k, burst.length)}`}>{messageText(m)}</p>
        </div>
      ))}
      {sent?.map((m, k) => (
        <motion.div key={k} className={`flex justify-end pl-16 ${k === 0 ? "mt-3" : ""}`}
          initial={reduce ? false : { opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...springs.snappy, delay: k * 0.06 }}>
          <p className={`px-3 py-2 text-[15px] leading-snug text-white ${corner("out", k, sent.length)}`} style={{ background: ACCENT }}>{m}</p>
        </motion.div>
      ))}
      {sent ? <motion.p className="mt-1 text-right text-[11px] text-neutral-400" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>보냄</motion.p> : null}
    </div>
  );
}

const VERSIONS = ["짧게", "나눠서"];

/** 입력칸 키: ⏎ 보내기 · Esc 넘기기 · Tab 다른 버전 (⇧⏎ 는 줄바꿈 = 말풍선 나누기) */
function composerKeys(e: React.KeyboardEvent, a: { send: () => void; skip: () => void; toggle: (() => void) | null }) {
  const act = e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing ? a.send : e.key === "Escape" ? a.skip : e.key === "Tab" ? a.toggle : null;
  if (!act) return;
  e.preventDefault();
  act();
}

/** 초안 2버전 탭. Tab 키로도 오간다. */
function VersionTabs({ version, onToggle }: { version: number | null; onToggle: () => void }) {
  if (version === null) return null;
  return (
    <div className="relative inline-flex rounded-full bg-neutral-950/[0.05] p-0.5" title="Tab 으로 바꾸기">
      {VERSIONS.map((label, k) => (
        <button key={label} type="button" onClick={() => k !== version && onToggle()}
          className={`relative rounded-full px-2.5 py-0.5 font-medium transition-colors ${k === version ? "text-neutral-950" : "text-neutral-500 hover:text-neutral-800"}`}>
          {k === version ? <motion.span layoutId="dm-draft-version" transition={springs.snappy} className="absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]" /> : null}
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
}

function SendButton({ appOnly, disabled, onClick }: { appOnly: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="mb-0.5 inline-flex shrink-0 items-center gap-1 text-[15px] font-semibold transition-opacity hover:opacity-70 active:scale-[0.96] disabled:opacity-40" style={{ color: ACCENT }}>
      {appOnly ? <>복사 · 앱 <Icon name="external" className="size-4" /></> : "보내기"}
    </button>
  );
}

function ThreadHeader({ convo }: { convo: Conversation }) {
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-3 px-4 shadow-[0_1px_0_0_rgba(10,10,10,0.08)]">
      <Avatar username={convo.peerUsername} size="lg" />
      <a href={convo.profileUrl ?? undefined} target="_blank" rel="noreferrer" className="truncate text-[15px] font-semibold text-neutral-950 hover:underline">{convo.peerUsername}</a>
    </div>
  );
}

export function ChatCard({
  convo,
  text,
  onText,
  basis,
  drafting,
  appOnly,
  onSend,
  onSkip,
  version,
  onToggleVersion,
  style,
  aiOff,
}: {
  convo: Conversation;
  text: string;
  onText: (v: string) => void;
  basis: BlitzBasis | null;
  drafting: boolean;
  /** 24시간이 지나 API 로 못 보내는 대화 — ⏎ 는 복사하고 인스타 앱 열기 */
  appOnly: boolean;
  onSend: (bubbles: string[]) => void;
  onSkip: () => void;
  /** 보이는 초안 버전 (0 = 짧게, 1 = 나눠서). null 이면 버전이 아직 없다 */
  version: number | null;
  onToggleVersion: () => void;
  /** 내 DM 말투 수치 — 말풍선 개수 경고 기준 */
  style: DmStyle | null;
  /** AI 가 없어 초안 없이 직접 쓰는 중 */
  aiOff: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [sent, setSent] = useState<string[] | null>(null);
  const bubbles = bubblesOf(text);
  useEffect(() => { ref.current?.focus(); }, [drafting]);
  // 긴 한 줄도 접혀 보이게: 글 높이만큼 늘린다 (최대 5줄 정도)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text, sent]);

  const placeholder = drafting ? "초안 쓰는 중..." : aiOff ? "메시지 입력... (⇧⏎ 말풍선 나누기)" : "메시지 입력...";
  const pulse = drafting ? "animate-pulse" : "";
  const send = () => {
    if (!bubbles.length || drafting || sent) return;
    if (appOnly) { onSend(bubbles); return; }
    setSent(bubbles); // 말풍선이 붙고 "보냄"을 잠깐 보여 준 뒤 다음 대화
    setTimeout(() => onSend(bubbles), SENT_PAUSE_MS);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ThreadHeader convo={convo} />
      <Thread convo={convo} sent={sent} />
      <div className="shrink-0 p-4">
        <div className="flex items-end gap-2 rounded-[22px] px-3 py-2 ring-1 ring-neutral-950/15 focus-within:ring-neutral-950/30">
          <Icon name="smile" className="mb-1 size-5 shrink-0 text-neutral-900" />
          <textarea ref={ref} value={sent ? "" : text} rows={1} disabled={drafting || !!sent}
            placeholder={placeholder} onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => composerKeys(e, { send, skip: onSkip, toggle: version === null ? null : onToggleVersion })}
            className={`min-w-0 flex-1 resize-none bg-transparent py-0.5 text-[15px] leading-[1.4] text-neutral-950 outline-none placeholder:text-neutral-500 ${pulse}`} />
          {bubbles.length && !sent ? <SendButton appOnly={appOnly} disabled={drafting} onClick={send} /> : null}
        </div>
        {sent || drafting ? null : <AiStrip text={text} basis={basis} style={style} onText={onText} version={version} onToggle={onToggleVersion} />}
      </div>
    </div>
  );
}

/**
 * 전체 초안 전에 뜨는 질문 팝업. 서아님만 아는 사실(일정·가격·계획)이 있어야 답할 수 있는 대화만 묻는다.
 * 답한 것만 반영해 전체 초안을 쓴다. 건너뛰면 질문 없이 전체 초안을 쓴다.
 */
export function QuestionsModal({
  questions,
  total,
  convos,
  answers,
  onAnswer,
  onDone,
  onSkip,
}: {
  questions: BlitzQuestion[];
  total: number;
  convos: Record<string, Conversation>;
  answers: Record<string, string>;
  onAnswer: (id: string, v: string) => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const reduce = useReducedMotion();
  // 포커스가 어디 있든 Esc 로 닫는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onSkip(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);
  const ready = questions.some((q) => answers[q.conversationId]?.trim());
  const submit = () => { if (ready) onDone(); };
  return (
    <div role="dialog" aria-modal="true" aria-label="초안 전에 물어볼 것" className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4">
      <motion.form onSubmit={(e) => { e.preventDefault(); submit(); }}
        initial={reduce ? false : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={springs.smooth}
        className="flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="shrink-0 space-y-1 px-5 pb-3 pt-5">
          <p className="text-[16px] font-semibold text-neutral-950">DM {total}개 초안 쓰기 전에 {questions.length}개만 알려 주세요</p>
          <p className="text-[13px] text-neutral-500">답한 내용은 그 대화 초안에만 들어가요. 모르면 비워 두세요.</p>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-3">
          {questions.map((q, n) => {
            const c = convos[q.conversationId];
            const last = c ? splitThread(c.messages).burst.at(-1) : undefined;
            return (
              <label key={q.conversationId} className="block space-y-2">
                <span className="flex items-center gap-2">
                  {c ? <Avatar username={c.peerUsername} size="sm" /> : null}
                  <span className="min-w-0 truncate rounded-[18px] bg-[#EFEFEF] px-3 py-1.5 text-[13px] text-neutral-800">{last ? messageText(last) : ""}</span>
                </span>
                <span className="block text-[15px] font-semibold text-neutral-950">{q.question}</span>
                <input autoFocus={n === 0} value={answers[q.conversationId] ?? ""} placeholder={q.hint}
                  onChange={(e) => onAnswer(q.conversationId, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                  className="w-full rounded-[22px] px-4 py-2 text-[14px] text-neutral-950 outline-none ring-1 ring-neutral-950/15 placeholder:text-neutral-400 focus:ring-neutral-950/30" />
              </label>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-4 px-5 py-4 shadow-[0_-1px_0_0_rgba(10,10,10,0.08)]">
          <button type="button" onClick={onSkip} className="text-[14px] font-medium text-neutral-500 hover:text-neutral-800">건너뛰고 만들기</button>
          <button type="submit" disabled={!ready} className="rounded-[10px] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: ACCENT }}>
            전체 초안 만들기 <span className="ml-1 text-[12px] font-normal opacity-80">⌘⏎</span>
          </button>
        </div>
      </motion.form>
    </div>
  );
}
