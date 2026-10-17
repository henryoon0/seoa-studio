"use client";

// 댓글 초안 만들기 팝업 — 최신 게시물 3개 중 고른 게시물의 남은 댓글만 초안을 쓴다.
// 1) 게시물 고르기(전체 선택 가능) → 2) 서버가 물어볼 정보가 있으면 질문 → 3) 백그라운드 초안 잡 시작.
// 초안은 자동으로 만들지 않는다. 서아님이 여기서 [초안 만들기]를 누를 때만 만든다.

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/icon";
import { springs } from "@/components/motion/presets";
import { postImageUrl, type Comment, type DraftJob, type MediaInfo } from "./comments-shared";

const IG_BLUE = "#3797F0";
const PICKABLE_POSTS = 3;

type Step = { kind: "pick" } | { kind: "asking" } | { kind: "questions"; questions: string[] } | { kind: "starting" };

/** 최신 게시물 3개 (올린 시각 최신순). 서버(draft-job.ts latestMedia)와 같은 규칙. */
export function latestPosts(media: Record<string, MediaInfo>): MediaInfo[] {
  return Object.values(media).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, PICKABLE_POSTS);
}

async function requestDrafts(body: Record<string, unknown>): Promise<{ questions?: string[]; job?: DraftJob; error?: string }> {
  try {
    const res = await fetch("/api/instagram/comments/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { questions?: string[]; job?: DraftJob; error?: string };
    return res.ok ? json : { error: json.error ?? "초안 만들기 실패" };
  } catch {
    return { error: "서버와 연결이 끊겼어요" };
  }
}

function PostChoice({ m, n, on, onToggle }: { m: MediaInfo; n: number; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" onClick={onToggle} aria-pressed={on}
        className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors ${on ? "bg-sky-50" : "hover:bg-neutral-950/[0.03]"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={postImageUrl(m.id)} alt="" className="size-14 shrink-0 rounded-lg bg-neutral-100 object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-neutral-950">{m.captionFirstLine || "(캡션 없음)"}</span>
          <span className="block text-[12px] text-neutral-500">{m.timestamp.slice(0, 10)} · 남은 댓글 {n}개</span>
        </span>
        <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${on ? "text-white" : "ring-1 ring-neutral-950/20"}`} style={on ? { background: IG_BLUE } : undefined}>
          {on ? <Icon name="check" className="size-3.5" /> : null}
        </span>
      </button>
    </li>
  );
}

function PickStep({ posts, counts, picked, setPicked, error, onStart }: {
  posts: MediaInfo[]; counts: Record<string, number>; picked: Set<string>; setPicked: (s: Set<string>) => void; error: string; onStart: () => void;
}) {
  const all = posts.length > 0 && posts.every((m) => picked.has(m.id));
  const total = posts.filter((m) => picked.has(m.id)).reduce((sum, m) => sum + (counts[m.id] ?? 0), 0);
  const toggle = (id: string) => { const s = new Set(picked); if (s.has(id)) s.delete(id); else s.add(id); setPicked(s); };
  return (
    <>
      <div className="flex items-center justify-between px-5 pt-1">
        <span className="text-[13px] text-neutral-500">최신 게시물 {posts.length}개 중에서 골라요</span>
        <button type="button" onClick={() => setPicked(all ? new Set() : new Set(posts.map((m) => m.id)))} className="text-[13px] font-semibold" style={{ color: IG_BLUE }}>
          {all ? "선택 해제" : "전체 선택"}
        </button>
      </div>
      <ul className="space-y-1 px-3 py-2">
        {posts.map((m) => <PostChoice key={m.id} m={m} n={counts[m.id] ?? 0} on={picked.has(m.id)} onToggle={() => toggle(m.id)} />)}
      </ul>
      {error ? <p className="px-5 text-[12px] text-rose-600">{error}</p> : null}
      <Footer>
        <button type="button" disabled={total === 0} onClick={onStart} className="rounded-[10px] px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40" style={{ background: IG_BLUE }}>
          댓글 {total}개 초안 만들기
        </button>
      </Footer>
    </>
  );
}

function QuestionsStep({ questions, answers, setAnswers, onDone, onSkip }: {
  questions: string[]; answers: Record<string, string>; setAnswers: (a: Record<string, string>) => void; onDone: () => void; onSkip: () => void;
}) {
  return (
    <>
      <p className="px-5 pt-1 text-[13px] text-neutral-500">초안 쓰기 전에 알려 주세요. 답은 저장해 두고 다음 초안에도 써요. 모르면 비워 두세요.</p>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto px-5 py-3">
        {questions.map((q, n) => (
          <label key={q} className="block space-y-1.5">
            <span className="block text-[14px] font-semibold text-neutral-950">{q}</span>
            <input autoFocus={n === 0} value={answers[q] ?? ""} onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onDone(); } }}
              className="w-full rounded-[22px] px-4 py-2 text-[14px] text-neutral-950 outline-none ring-1 ring-neutral-950/15 focus:ring-neutral-950/30" />
          </label>
        ))}
      </div>
      <Footer>
        <button type="button" onClick={onSkip} className="text-[14px] font-medium text-neutral-500 hover:text-neutral-800">건너뛰고 만들기</button>
        <button type="button" onClick={onDone} className="rounded-[10px] px-4 py-2 text-[14px] font-semibold text-white" style={{ background: IG_BLUE }}>
          초안 만들기 <span className="ml-1 text-[12px] font-normal opacity-80">⌘⏎</span>
        </button>
      </Footer>
    </>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-4 px-5 py-4 shadow-[0_-1px_0_0_rgba(10,10,10,0.08)]">{children}</div>;
}

export function DraftPostsModal({ media, pending, onClose, onStarted }: {
  media: Record<string, MediaInfo>; pending: Comment[]; onClose: () => void; onStarted: (job: DraftJob) => void;
}) {
  const reduce = useReducedMotion();
  // 포커스가 어디 있든 Esc 로 닫는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const posts = latestPosts(media);
  const counts: Record<string, number> = {};
  for (const c of pending) counts[c.mediaId] = (counts[c.mediaId] ?? 0) + 1;
  // 처음엔 남은 댓글이 있는 게시물을 골라 둔다
  const [picked, setPicked] = useState(() => new Set(posts.filter((m) => counts[m.id]).map((m) => m.id)));
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const mediaIds = posts.filter((m) => picked.has(m.id)).map((m) => m.id);

  const finish = async (body: Record<string, unknown>) => {
    setStep({ kind: "starting" });
    const out = await requestDrafts({ mediaIds, ...body });
    if (out.job) { onStarted(out.job); onClose(); return; }
    setError(out.error ?? "초안 만들기 실패");
    setStep({ kind: "pick" });
  };
  const start = async () => {
    setError("");
    setStep({ kind: "asking" });
    const out = await requestDrafts({ mediaIds });
    if (out.questions?.length) { setStep({ kind: "questions", questions: out.questions }); return; }
    if (out.job) { onStarted(out.job); onClose(); return; }
    setError(out.error ?? "초안 만들기 실패");
    setStep({ kind: "pick" });
  };
  const questions = step.kind === "questions" ? step.questions : [];
  const answered = questions.map((q) => ({ question: q, answer: answers[q] ?? "" })).filter((a) => a.answer.trim());

  return (
    <div role="dialog" aria-modal="true" aria-label="댓글 초안 만들기" className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4"
      onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={reduce ? false : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={springs.smooth}
        className="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center px-5 pb-2 pt-5">
          <p className="text-[16px] font-semibold text-neutral-950">댓글 초안 만들기</p>
          <button type="button" onClick={onClose} aria-label="닫기" className="ml-auto flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-950/[0.05]">
            <Icon name="close" className="size-4" />
          </button>
        </div>
        {step.kind === "pick" ? (
          <PickStep posts={posts} counts={counts} picked={picked} setPicked={setPicked} error={error} onStart={() => void start()} />
        ) : step.kind === "questions" ? (
          <QuestionsStep questions={questions} answers={answers} setAnswers={setAnswers}
            onDone={() => void finish(answered.length ? { answers: answered } : { skipQuestions: true })} onSkip={() => void finish({ skipQuestions: true })} />
        ) : (
          <p className="animate-pulse px-5 pb-8 pt-4 text-[14px] text-neutral-500">{step.kind === "asking" ? "물어볼 것이 있는지 보는 중" : "초안 만들기 시작하는 중"}</p>
        )}
      </motion.div>
    </div>
  );
}
