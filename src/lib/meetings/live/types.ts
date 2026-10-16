// 회의 중 실시간 요약(Tiro 식) — 녹음이 도는 동안 1분마다 새 전사 조각만
// 이전 요약에 얹어 갱신한다. 회의 뒤 최종 요약(analysis)은 그대로 따로 돈다.

import type { SegmentRow } from "../local-asr";

export interface LiveSummary {
  /** 지금 이야기하는 주제 한 줄. */
  topic: string;
  decisions: string[];
  /** 녹음한 사람(henry)이 할 일. */
  myActions: string[];
  openQuestions: string[];
}

export interface LiveUpdate {
  at: string;
  /** 이 갱신까지 반영한 녹음 길이(초). */
  processedSec: number;
  ok: boolean;
  error?: string;
}

export interface LiveSession {
  /** 녹음 세션 폴더 이름(meeting_<mode>_<시각>). */
  id: string;
  sessionDir: string;
  mode: "remote" | "inperson";
  processedSec: number;
  /** 요약에 반영한 지점(초). 요약이 실패한 조각은 다음 갱신에 함께 들어간다. */
  summarizedSec: number;
  segments: SegmentRow[];
  summary: LiveSummary;
  updates: LiveUpdate[];
  /** 진행 중인 갱신의 시작 시각 — 겹침 방지와 멈춤 판정에 쓴다. */
  runningSince?: string;
  /** 갱신 단계가 바뀔 때마다 찍는다(전사 → 요약). */
  heartbeatAt?: string;
}

export const EMPTY_SUMMARY: LiveSummary = {
  topic: "",
  decisions: [],
  myActions: [],
  openQuestions: [],
};
