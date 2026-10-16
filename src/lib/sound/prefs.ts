"use client";

/**
 * 소리 설정 SSOT. localStorage에 저장하고 모듈 레벨 pub/sub으로 화면에 알린다
 * (toast.ts와 같은 패턴 — Provider를 새로 끼우지 않는다).
 *
 * 서버 렌더 중에는 항상 기본값을 돌려준다. 실제 값은 브라우저에서 첫 구독 때
 * 읽어 오므로, 이 값을 SSR 마크업에 그리면 hydration이 어긋난다.
 */

import { setMasterVolume } from "./context";
import type { SoundTheme } from "./library";

export interface SoundPrefs {
  /** 전체 스위치. 끄면 playSound가 아무 것도 하지 않는다. */
  enabled: boolean;
  /** 0~1 마스터 볼륨. */
  volume: number;
  /** 소리 톤(같은 이름을 어떤 색으로 낼지). */
  theme: SoundTheme;
  /**
   * hover/focus 같은 "스치는" 소리까지 낼지. 기본은 끔 — 마우스만 움직여도
   * 계속 울리면 금방 피곤해진다.
   */
  ambient: boolean;
}

export const DEFAULT_PREFS: SoundPrefs = {
  enabled: true,
  volume: 0.6,
  theme: "core",
  ambient: false,
};

const STORAGE_KEY = "dashboard.sound";

let prefs: SoundPrefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<(p: SoundPrefs) => void>();

function clamp01(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n)
    ? Math.min(1, Math.max(0, n))
    : fallback;
}

function read(): SoundPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_PREFS.enabled,
      volume: clamp01(parsed.volume, DEFAULT_PREFS.volume),
      theme: (parsed.theme as SoundTheme) || DEFAULT_PREFS.theme,
      ambient: typeof parsed.ambient === "boolean" ? parsed.ambient : DEFAULT_PREFS.ambient,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 브라우저에서 처음 필요할 때 한 번만 localStorage를 읽는다. */
export function getPrefs(): SoundPrefs {
  if (!loaded && typeof window !== "undefined") {
    prefs = read();
    loaded = true;
    setMasterVolumeSafely(prefs.volume);
  }
  return prefs;
}

// 볼륨 반영은 AudioContext를 새로 만들지 않는다(context.ts가 값만 기억해 둔다).
function setMasterVolumeSafely(volume: number) {
  try {
    setMasterVolume(volume);
  } catch {}
}

export function setPrefs(patch: Partial<SoundPrefs>): SoundPrefs {
  const next = { ...getPrefs(), ...patch };
  next.volume = clamp01(next.volume, DEFAULT_PREFS.volume);
  prefs = next;
  loaded = true;
  setMasterVolumeSafely(next.volume);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function subscribePrefs(fn: (p: SoundPrefs) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
