"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { playUi } from "@/lib/sound/events";

/**
 * A single light segment that travels around a card's perimeter, signalling
 * "this surface is generating right now" (inspired by beam.jakubantalik.com).
 *
 * Drop it inside any `relative` box that has a rounded-* radius. It rides the
 * border with `offset-path`, masked to a thin band so only the edge glows.
 * Pure CSS animation (no motion runtime), SSR-safe, and disabled under
 * prefers-reduced-motion (see globals.css `.border-beam-seg`).
 *
 * Color defaults to the brand green per the generation-accent rule — do not
 * reach for violet. Radius must match the host card's radius so the beam
 * tracks the actual corners.
 */
export function BorderBeam({
  radius = 16,
  borderWidth = 1.5,
  size = 80,
  duration = 4,
  delay = 0,
  colorFrom = "#00BD7D",
  colorTo = "#34e2a8",
  silent = false,
  className = "",
}: {
  /** Corner radius in px, match the host card (e.g. rounded-2xl -> 16). */
  radius?: number;
  /** Thickness of the glowing band in px. */
  borderWidth?: number;
  /** Length of the traveling light segment in px. */
  size?: number;
  /** Seconds for one full lap. */
  duration?: number;
  /** Seconds to offset the start (stagger multiple beams). */
  delay?: number;
  /** Leading edge color of the beam. */
  colorFrom?: string;
  /** Trailing color that fades into transparent. */
  colorTo?: string;
  /** 소리 없이 띄운다(장식용으로 쓸 때). */
  silent?: boolean;
  className?: string;
}) {
  // 빔이 나타나는 순간 = 생성이 시작된 순간. 생성 시작을 알리는 곳이 화면마다
  // 흩어져 있어서, 표시가 켜지는 이 한 곳에서 소리를 낸다. 시안 3벌처럼 빔이
  // 여러 개 뜨면 playSound 의 최소 간격(45ms)이 하나로 합쳐 준다.
  useEffect(() => {
    if (!silent) playUi("jobStart");
  }, [silent]);

  return (
    <div
      aria-hidden
      className={`border-beam-mask pointer-events-none absolute inset-0 rounded-[inherit] ${className}`}
      style={
        {
          padding: borderWidth,
          WebkitMask:
            "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          maskComposite: "exclude",
        } as CSSProperties
      }
    >
      <div
        className="border-beam-seg absolute aspect-square"
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${radius}px)`,
            offsetDistance: "0%",
            background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
            animation: `border-beam ${duration}s linear infinite`,
            animationDelay: `${-delay}s`,
          } as CSSProperties
        }
      />
    </div>
  );
}
