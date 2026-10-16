import { Icon } from "@/components/icon";
// DM 폼 선택 팝업 — 프로토타입 시안 3(미리보기 분할) 확정본 (2026-08-04, henry 선택).
// 왼쪽에서 폼을 고르면 오른쪽에 "답장에 이렇게 들어가요"가 실제 보낼 말풍선으로 그려진다.
// 오발송 방지가 목적: 보내기 전에 최종 모습을 눈으로 확인하고 넣는다.
// "use client" 없음: dm-client(클라이언트)에서만 import 된다.

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export interface PickerForm {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
  kind: "apply" | "review" | "survey";
  recentSubmissions: number;
}

const KIND_LABELS: Record<PickerForm["kind"], string> = {
  apply: "신청",
  review: "후기",
  survey: "설문",
};

const KIND_CHIP: Record<PickerForm["kind"], string> = {
  apply: "bg-emerald-100 text-emerald-800",
  review: "bg-sky-100 text-sky-700",
  survey: "bg-amber-100 text-amber-700",
};

export function DmFormPicker({
  open,
  forms,
  draft,
  onClose,
  onPick,
}: {
  open: boolean;
  forms: PickerForm[];
  /** 현재 답장 본문 — 링크가 붙은 최종 모습을 미리 그린다 */
  draft: string;
  onClose: () => void;
  onPick: (form: PickerForm) => void;
}) {
  const reduce = useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 열 때마다 첫 폼으로 리셋 (직전 선택이 남아 있으면 다른 대화에서 오발송 여지).
  // effect 대신 렌더 중 조정 패턴 — 닫힘→열림 전이를 잡는다.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSelectedId(null);
  }
  const selected = forms.find((f) => f.id === selectedId) ?? forms[0] ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const preview = selected
    ? draft.trim()
      ? `${draft.replace(/\s+$/, "")}\n${selected.url}`
      : selected.url
    : "";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
        >
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-neutral-950/5"
          >
            <div className="flex items-center gap-2 p-3 shadow-[0_1px_0_0_rgba(10,10,10,0.05)]">
              <p className="text-sm font-semibold text-neutral-900">보낼 폼 고르기</p>
              <span className="text-[11px] text-neutral-500">지금 열려 있는 폼 {forms.length}개</span>
              <span className="ml-auto" />
              <button
                onClick={onClose}
                aria-label="닫기"
                className="rounded-md p-1 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600"
              >
                <Icon name="close" className="size-4" />
              </button>
            </div>

            {forms.length === 0 || !selected ? (
              <p className="p-10 text-center text-sm text-neutral-500">
                지금 열려 있는 폼이 없어요. 인스타 관리 화면에서 폼을 활성화하면 여기 떠요.
              </p>
            ) : (
              <div className="flex max-h-[60vh]">
                {/* 왼쪽: 폼 목록 */}
                <div className="w-64 shrink-0 space-y-1 overflow-y-auto p-3 shadow-[-1px_0_0_0_rgba(10,10,10,0.05)]">
                  {forms.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedId(f.id)}
                      className={`w-full rounded-lg p-3 text-left transition-colors ${
                        selected.id === f.id ? "bg-emerald-50" : "hover:bg-neutral-50"
                      }`}
                    >
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_CHIP[f.kind]}`}>
                        {KIND_LABELS[f.kind]}
                      </span>
                      <p
                        className={`mt-1.5 text-[13px] font-medium leading-snug ${
                          selected.id === f.id ? "text-emerald-900" : "text-neutral-800"
                        }`}
                      >
                        {f.title}
                      </p>
                    </button>
                  ))}
                </div>

                {/* 오른쪽: 확인 + 미리보기 */}
                <div className="flex min-w-0 flex-1 flex-col p-4">
                  <p className="text-[15px] font-medium leading-snug text-neutral-900">{selected.title}</p>
                  <p className="mt-1 font-mono text-[11px] text-neutral-500">{selected.url}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    최근 30일 제출 {selected.recentSubmissions}건 · {selected.updatedAt.slice(0, 10)} 수정
                  </p>

                  <div className="mt-4 flex-1 overflow-y-auto">
                    <p className="mb-1.5 text-[11px] font-medium text-neutral-500">답장에 이렇게 들어가요</p>
                    <div className="rounded-2xl rounded-br-md bg-emerald-700 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white">
                      {preview}
                    </div>
                  </div>

                  <button
                    onClick={() => onPick(selected)}
                    className="mt-4 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 text-sm font-medium text-white hover:bg-emerald-800 transition-[background-color,scale] duration-150 ease-[var(--motion-ease-out)] active:scale-[0.98]"
                  >
                    <Icon name="check" className="size-4" /> 이 폼 넣기
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
