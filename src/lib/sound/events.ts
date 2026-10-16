"use client";

/**
 * 앱 사건 → 소리 이름 매핑.
 *
 * 호출부는 "ding"이 아니라 "저장했다"라고 말한다. 나중에 톤이 마음에 안 들면
 * 화면을 뒤지지 않고 이 표 한 줄만 고치면 된다.
 */

import { playSound, type PlaySoundOptions } from "./index";
import type { SoundName } from "./library";

export type UiEvent =
  // 누르기
  | "click"
  | "select"
  | "toggleOn"
  | "toggleOff"
  // 열고 닫기
  | "open"
  | "close"
  | "expand"
  | "collapse"
  | "tabSwitch"
  // 결과
  | "saved"
  | "deleted"
  | "copied"
  | "sent"
  | "success"
  | "error"
  | "warning"
  | "notify"
  // 오래 걸리는 작업 (AI 생성, 전사, 굽기)
  | "jobStart"
  | "jobDone";

export const UI_SOUNDS: Record<UiEvent, SoundName> = {
  click: "click",
  select: "select",
  toggleOn: "toggle-on",
  toggleOff: "toggle-off",

  open: "modal-open",
  close: "modal-close",
  expand: "expand",
  collapse: "collapse",
  tabSwitch: "tab-switch",

  saved: "save",
  deleted: "delete",
  copied: "copy",
  sent: "send",
  success: "success",
  error: "error",
  warning: "warning",
  notify: "notification",

  jobStart: "loading-start",
  jobDone: "loading-end",
};

/** 앱 언어로 소리를 낸다. `playUi("saved")` */
export function playUi(event: UiEvent, opts?: PlaySoundOptions): void {
  playSound(UI_SOUNDS[event], opts);
}

/**
 * 오래 걸리는 작업(AI 초안, 전사, 굽기)이 끝났을 때 어떤 소리를 낼지 고른다.
 *
 * 짧게 끝난 작업과 몇 분을 기다린 작업은 같은 무게가 아니다. 화면을 보고 있던
 * 사람과 다른 탭에 가 있던 사람도 다르다.
 */
export function pickCompletionSound(elapsedMs: number, ok: boolean): SoundName {
  // TODO(human): 걸린 시간(elapsedMs)과 성공 여부(ok)로 소리를 고른다.
  return ok ? "success" : "error";
}

/** 작업 완료 소리를 낸다. 실패면 실패 소리. */
export function playCompletion(elapsedMs: number, ok: boolean): void {
  playSound(pickCompletionSound(elapsedMs, ok));
}
