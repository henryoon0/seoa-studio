"use client";

import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { playUi } from "@/lib/sound/events";

// 파괴적 동작 인라인 2-step 확인 (DAS-5). OS confirm() 대체.
// 첫 클릭 -> 확인 상태(rose 톤, ARM_MS 안에 다시 누르면 실행), 지나면 원복.

const ARM_MS = 3000;

export function ConfirmButton({
  onConfirm,
  confirmLabel = "한 번 더 누르면 실행",
  confirmClassName = "text-rose-600 bg-rose-50 ring-1 ring-rose-200",
  className = "",
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  onConfirm: () => void | Promise<void>;
  confirmLabel?: ReactNode;
  confirmClassName?: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      {...rest}
      onClick={(e) => {
        // 행/카드 클릭 안에 놓인 삭제 버튼의 stopPropagation 용도로 onClick을 허용.
        onClick?.(e);
        if (armed) {
          if (timer.current) clearTimeout(timer.current);
          setArmed(false);
          // 실행되는 순간에 소리를 낸다. 결과(성공/실패)는 토스트가 따로 알린다.
          playUi("deleted");
          void onConfirm();
          return;
        }
        // 첫 클릭은 "지금 되돌릴 수 없는 걸 누르려 한다"는 경고 단계다.
        playUi("warning");
        setArmed(true);
        timer.current = setTimeout(() => setArmed(false), ARM_MS);
      }}
      className={`${className} ${armed ? confirmClassName : ""} transition-colors`}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
