"use client";
import { Icon } from "@/components/icon";

// 답글 카드 (09-27 픽: 초안 3개 중 고르기). 후보 3개는 화면을 열기 전에 서버가 이미 만들어 둔다.
// 칩을 누르면 그 글이 입력칸으로 들어가고, 입력칸을 고치면 어느 칩도 선택되지 않은 "직접 고침" 상태가 된다.

import { useState } from "react";
import { Disclosure, TONE_LABEL, type DraftOption } from "./comments-shared";

const press = "transition-[color,background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.96]";

export function DraftChips({
  options,
  value,
  onPick,
  drafting,
}: {
  options: DraftOption[] | undefined;
  value: string;
  onPick: (text: string) => void;
  /** 후보가 아직 없고 서버가 쓰는 중 */
  drafting: boolean;
}) {
  if (!options || options.length === 0) {
    return drafting ? (
      <p className="flex items-center gap-1.5 px-3 pt-3 text-[11px] text-emerald-700">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
        초안 3개를 쓰는 중이에요
      </p>
    ) : null;
  }
  const picked = options.find((o) => o.text.trim() === value.trim())?.tone;
  return (
    <div className="grid grid-cols-3 gap-1.5 px-2 pt-2">
      {options.map((o) => {
        const on = o.tone === picked;
        return (
          <button
            key={o.tone}
            type="button"
            onClick={() => onPick(o.text)}
            aria-pressed={on}
            className={`rounded-[12px] px-2.5 py-2 text-left ${press} ${
              on ? "bg-emerald-50 ring-1 ring-emerald-700/30" : "bg-neutral-50 ring-1 ring-neutral-950/5 hover:bg-neutral-100"
            }`}
          >
            <span className={`flex items-center gap-1 text-[11px] font-medium ${on ? "text-emerald-700" : "text-neutral-600"}`}>
              {on ? <Icon name="check" className="size-3" /> : null}
              {TONE_LABEL[o.tone]}
            </span>
            <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-neutral-500">{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CommentReplyCard({
  value,
  onChange,
  options,
  drafting,
  regenerating,
  onRegenerate,
  onSkip,
  queued,
  onToggleQueue,
  inServerQueue,
  onUnqueue,
}: {
  value: string;
  onChange: (text: string) => void;
  options: DraftOption[] | undefined;
  drafting: boolean;
  regenerating: boolean;
  onRegenerate: (instruction: string) => void;
  onSkip: () => void;
  /** 발송에 담김(아래 대기줄 바) */
  queued: boolean;
  onToggleQueue: () => void;
  /** 이미 서버 발송 대기줄에 들어가 있음 */
  inServerQueue: boolean;
  onUnqueue: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [instruction, setInstruction] = useState("");

  return (
    <div className="rounded-[18px] bg-white p-1 shadow-card ring-1 ring-neutral-950/5">
      <DraftChips options={options} value={value} onPick={onChange} drafting={drafting} />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={drafting ? "초안이 곧 들어와요" : "따뜻하게 한마디 남겨주세요"}
        className="w-full resize-none rounded-[14px] bg-white px-4 pb-2 pt-3 text-[15px] leading-[1.6] text-neutral-800 focus:outline-none"
      />

      {/* 지시는 매번 쓰는 칸이 아니라서 접어둔다 */}
      <Disclosure open={noteOpen}>
        <div className="px-3 pb-2">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) onRegenerate(instruction);
            }}
            placeholder="더 짧게 / 5기 마감 언급 … (비워두면 그냥 다시 쓰기)"
            className="w-full rounded-[10px] bg-neutral-50 px-3 py-2 text-xs text-neutral-700 ring-1 ring-neutral-950/5 focus:outline-none focus:ring-emerald-600/40"
          />
        </div>
      </Disclosure>

      <div className="flex items-center gap-1.5 px-2 pb-2">
        <button
          type="button"
          onClick={() => onRegenerate(instruction)}
          disabled={regenerating}
          className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 ${press}`}
        >
          <Icon name="sparkles" className={`size-3.5 ${regenerating ? "animate-pulse" : ""}`} />
          {regenerating ? "쓰는 중..." : "3개 다시 쓰기"}
        </button>
        <button
          type="button"
          onClick={() => setNoteOpen((o) => !o)}
          className={`inline-flex h-9 items-center gap-0.5 rounded-[10px] px-2.5 text-xs ${press} ${
            noteOpen ? "bg-neutral-100 text-neutral-700" : "text-neutral-500 hover:bg-neutral-50"
          }`}
        >
          <Icon name="plus" className="size-3.5" />
          지시 추가
        </button>

        <span className="ml-auto" />

        <button
          type="button"
          onClick={onSkip}
          className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700 ${press}`}
        >
          <Icon name="fast-forward" className="size-4" /> 건너뛰기
        </button>
        {inServerQueue ? (
          <button
            type="button"
            onClick={onUnqueue}
            className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-xs text-neutral-600 ring-1 ring-neutral-950/5 hover:bg-neutral-50 ${press}`}
          >
            <Icon name="close" className="size-4" /> 대기줄에서 빼기
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleQueue}
            disabled={!value.trim()}
            className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3.5 text-xs font-medium disabled:opacity-40 ${press} ${
              queued ? "bg-emerald-700 text-white hover:bg-emerald-800" : "text-emerald-700 ring-1 ring-neutral-950/5 hover:bg-emerald-50"
            }`}
          >
            <Icon name="check" className="size-4" />
            {queued ? "담았어요" : "발송에 담기"}
          </button>
        )}
      </div>
    </div>
  );
}
