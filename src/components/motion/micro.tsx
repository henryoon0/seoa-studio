"use client";

// 재사용 마이크로 인터랙션 조각들.
// Amicro(github.com/Subhan-code/Amicro--Micro-transitions-) 의 entrance / hover 패턴을
// 이 대시보드 규칙에 맞게 옮긴 것 — 색·테두리는 여기서 정하지 않고 전부 className 으로 받는다
// (UI 규칙: border 금지, edge 는 ring-1, 강조는 emerald).
// 모든 조각은 prefers-reduced-motion 을 존중한다.

import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { useRef, type ReactNode } from "react";
import { enterVariants, exitVariant, springs, staggerDelay } from "./presets";

/** 등장 애니메이션 (올라오며 흐림 걷힘). index 를 주면 목록 스태거가 된다. */
export function FadeUp({
  children,
  index = 0,
  className = "",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={enterVariants}
      transition={{ ...springs.smooth, delay: staggerDelay(index) }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function FadeUpItem({
  children,
  index = 0,
  className = "",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <li className={className}>{children}</li>;
  return (
    <motion.li
      initial="hidden"
      animate="visible"
      variants={enterVariants}
      transition={{ ...springs.smooth, delay: staggerDelay(index) }}
      className={className}
    >
      {children}
    </motion.li>
  );
}

/**
 * 내용이 바뀌는 자리(상세 패널 등)를 부드럽게 교체한다.
 * key 가 바뀔 때만 움직이고, 첫 렌더에는 애니메이션을 걸지 않는다(initial={false}).
 */
export function SwapPanel({
  swapKey,
  children,
  className = "",
}: {
  swapKey: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={swapKey}
        initial={enterVariants.hidden}
        animate={enterVariants.visible}
        exit={exitVariant}
        transition={springs.gentle}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * 탭·세그먼트의 활성 알약. 같은 groupId 를 쓰는 형제들 사이를 미끄러져 이동한다.
 * 알약은 배경만 담당하므로 라벨은 이 컴포넌트 밖(위 레이어)에 둔다.
 */
export function ActivePill({
  groupId,
  className = "",
  positionClassName = "inset-0",
}: {
  groupId: string;
  className?: string;
  positionClassName?: string;
}) {
  const reduce = useReducedMotion();
  const classes = `absolute ${positionClassName} ${className}`;
  if (reduce) return <span className={classes} />;
  return (
    <motion.span
      layoutId={groupId}
      transition={springs.snappy}
      className={classes}
    />
  );
}

export function AnimatedCheck({
  checked,
  children,
  className = "",
}: {
  checked: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return checked ? <span className={className}>{children}</span> : null;
  }
  return (
    <AnimatePresence initial={false}>
      {checked ? (
        <motion.span
          key="checked"
          initial={{
            opacity: 0,
            transform: "scale(0.8)",
            filter: "blur(2px)",
          }}
          animate={{
            opacity: 1,
            transform: "scale(1)",
            filter: "blur(0px)",
          }}
          exit={{
            opacity: 0,
            transform: "scale(0.9)",
            filter: "blur(1px)",
          }}
          transition={springs.snappy}
          className={className}
        >
          {children}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * 커서가 가까워지면 살짝 끌려오는 버튼 (Amicro magnetic-button).
 * 끌림 폭은 대시보드용으로 줄였다 — 눌러야 할 곳이 도망가면 안 된다.
 */
export function MagneticButton({
  children,
  onClickAction,
  disabled,
  title,
  className = "",
  strength = 0.18,
  range = 60,
}: {
  children: ReactNode;
  onClickAction?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  strength?: number;
  range?: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 200, damping: 20, mass: 0.6 });
  const y = useSpring(0, { stiffness: 200, damping: 20, mass: 0.6 });
  const transform = useMotionTemplate`translate3d(${x}px, ${y}px, 0)`;

  const pull = (e: React.MouseEvent) => {
    if (reduce || disabled || !ref.current) return;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    const dx = e.clientX - (left + width / 2);
    const dy = e.clientY - (top + height / 2);
    const near = Math.hypot(dx, dy) < range;
    x.set(near ? dx * strength : 0);
    y.set(near ? dy * strength : 0);
  };
  const release = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span
      onMouseMove={pull}
      onMouseLeave={release}
      style={reduce ? undefined : { transform }}
      className="inline-flex"
    >
      <motion.button
        ref={ref}
        type="button"
        onClick={onClickAction}
        disabled={disabled}
        title={title}
        whileTap={
          reduce || disabled ? undefined : { transform: "scale(0.96)" }
        }
        className={className}
      >
        {children}
      </motion.button>
    </motion.span>
  );
}
