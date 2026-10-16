"use client";
import { Icon } from "@/components/icon";

import { useEffect, useState } from "react";

// 앱 톤 알림 SSOT (DAS-5). OS alert() 대체.
// 모듈 레벨 pub/sub: 어디서든 toast.success/error 호출, 루트에 <Toaster /> 1개.
// 색 SSOT: 성공=emerald, 오류=rose.

type ToastKind = "success" | "error";

/** 토스트 안 버튼 하나 (예: 되돌리기) */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

const DISMISS_MS = 4000;
// Exit is faster than enter (the system responding should snap); keep in sync
// with the .toast-item[data-leaving] transition in globals.css.
const EXIT_MS = 160;

let listener: ((t: ToastItem) => void) | null = null;
let seq = 0;

function emit(kind: ToastKind, message: string, action?: ToastAction) {
  listener?.({ id: ++seq, kind, message, action });
  // 알림 소리. 동적 import라 소리 레시피가 첫 토스트 전까지 번들에 안 실린다.
  // 소리가 실패해도 토스트는 이미 떴다 — 그래서 결과를 기다리지 않는다.
  void import("@/lib/sound")
    .then((m) => m.playSound(kind === "success" ? "success" : "error"))
    .catch(() => {});
}

export const toast = {
  success(message: string, action?: ToastAction) {
    emit("success", message, action);
  },
  error(message: string) {
    emit("error", message);
  },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Ids currently animating out. Two-phase removal: mark leaving (CSS exit
  // plays), then drop from the list after EXIT_MS so the exit is visible.
  const [leaving, setLeaving] = useState<Set<number>>(new Set());

  useEffect(() => {
    listener = (t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setLeaving((prev) => new Set(prev).add(t.id));
        setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== t.id));
          setLeaving((prev) => {
            const next = new Set(prev);
            next.delete(t.id);
            return next;
          });
        }, EXIT_MS);
      }, DISMISS_MS);
    };
    return () => {
      listener = null;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          data-leaving={leaving.has(t.id) || undefined}
          className="toast-item pointer-events-auto flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm text-neutral-800 ring-1 ring-neutral-950/5 shadow-lg shadow-neutral-950/5"
        >
          {t.kind === "success" ? (
            <Icon name="check-circle" className="size-4 text-emerald-500" />
          ) : (
            <Icon name="error" className="size-4 text-rose-500" />
          )}
          {t.message}
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                setLeaving((prev) => new Set(prev).add(t.id));
              }}
              className="ml-1 font-medium text-emerald-700 hover:text-emerald-800"
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
