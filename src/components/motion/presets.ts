// 마이크로 인터랙션 스프링 프리셋.
// 출처: Amicro (github.com/Subhan-code/Amicro--Micro-transitions-, registry/lib/presets.ts).
// 그대로 베끼지 않고 이 대시보드 톤(조용한 라이트 UI)에 맞춰 값을 줄였다.
// CSS 쪽 대응 토큰은 globals.css 의 --motion-ease-* 다. 둘이 같은 성격을 갖게 유지할 것.
import type { Transition } from "motion/react";

export const springs = {
  /** 눌림·토글처럼 즉답이 필요한 것 */
  snappy: { type: "spring", stiffness: 400, damping: 32, mass: 0.8 },
  /** 기본값. 자리 이동·전환 */
  smooth: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
  /** 큰 면적이 움직일 때 (패널 교체) */
  gentle: { type: "spring", stiffness: 160, damping: 24, mass: 1 },
} satisfies Record<string, Transition>;

export const enterVariants = {
  hidden: {
    opacity: 0,
    transform: "translate3d(0, 8px, 0)",
    filter: "blur(4px)",
  },
  visible: {
    opacity: 1,
    transform: "translate3d(0, 0, 0)",
    filter: "blur(0px)",
  },
};

/** 퇴장은 등장보다 짧고 얕게 (시선을 뺏지 않는다) */
export const exitVariant = {
  opacity: 0,
  transform: "translate3d(0, -4px, 0)",
  filter: "blur(2px)",
  transition: {
    duration: 0.14,
    ease: [0.23, 1, 0.32, 1],
  },
} as const;

/** 목록 스태거: 항목이 많아도 총 대기시간이 길어지지 않게 상한을 둔다 */
export function staggerDelay(index: number, step = 0.03, max = 0.24): number {
  return Math.min(index * step, max);
}
