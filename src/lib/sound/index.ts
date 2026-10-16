"use client";

/**
 * 소리 재생 공개 API.
 *
 *   import { playSound } from "@/lib/sound";
 *   playSound("success");
 *
 * 오디오 파일은 없다. 레시피(library.ts)를 synth.ts가 브라우저에서 즉석 합성한다.
 * 소리가 꺼져 있거나 서버 렌더 중이면 조용히 아무 것도 하지 않는다.
 */

import { SOUND_LIBRARY, SOUND_NAMES, type SoundName, type SoundTheme } from "./library";
import { getPrefs } from "./prefs";
import { playPatch, type PlayOptions } from "./synth";

export { SOUND_NAMES, SOUND_THEMES, type SoundName, type SoundTheme } from "./library";
export { DEFAULT_PREFS, getPrefs, setPrefs, subscribePrefs, type SoundPrefs } from "./prefs";
export type { Patch } from "./patch";

/**
 * 마우스가 스치기만 해도 나는 소리들. prefs.ambient가 꺼져 있으면 건너뛴다.
 * 이걸 기본으로 켜면 커서를 움직이는 내내 울려서 금방 끄고 싶어진다.
 */
const AMBIENT: ReadonlySet<string> = new Set([
  "hover",
  "focus",
  "blur",
  "tick",
  "scroll-snap",
  "key-press",
]);

/**
 * 같은 소리가 연달아 겹치면 소리가 뭉쳐서 커진다. 이름별로 최소 간격을 둔다
 * (리스트 렌더 중 같은 이벤트가 여러 번 터지는 경우 방어).
 */
const MIN_GAP_MS = 45;
const lastPlayedAt = new Map<string, number>();

export function isSoundName(name: string): name is SoundName {
  return (SOUND_NAMES as readonly string[]).includes(name);
}

/** 톤에 그 이름이 없으면 core로 떨어진다(core만 62개 전부 가지고 있다). */
export function resolvePatch(name: SoundName, theme: SoundTheme) {
  return SOUND_LIBRARY[theme]?.[name] ?? SOUND_LIBRARY.core[name];
}

export interface PlaySoundOptions extends PlayOptions {
  /** ambient 설정과 무관하게 강제로 재생(설정 화면 미리듣기용). */
  force?: boolean;
  /** 톤 지정. 없으면 사용자 설정 톤. */
  theme?: SoundTheme;
}

export function playSound(name: SoundName, opts: PlaySoundOptions = {}): void {
  if (typeof window === "undefined") return;

  const prefs = getPrefs();
  if (!opts.force) {
    if (!prefs.enabled) return;
    if (AMBIENT.has(name) && !prefs.ambient) return;

    const now = Date.now();
    const last = lastPlayedAt.get(name) ?? 0;
    if (now - last < MIN_GAP_MS) return;
    lastPlayedAt.set(name, now);
  }

  const patch = resolvePatch(name, opts.theme ?? prefs.theme);
  if (!patch) return;

  // 오디오 실패가 클릭 핸들러를 깨뜨리면 안 된다. 소리는 항상 부가 기능이다.
  void playPatch(patch, { volume: opts.volume, detune: opts.detune, jitter: opts.jitter }).catch(
    () => {},
  );
}
