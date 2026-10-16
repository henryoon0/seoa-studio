// 전역 CLI 동시성 캡.
//
// claude/codex 자식 프로세스가 무한정 떠서 박스를 마비시키는 걸 막는다.
// 자동완성 연타나 Promise.all 팬아웃이 한꺼번에 수십 개 프로세스를 띄우는 게 위협.
//
// 캡은 트랜스포트 안쪽(runClaudeCLIOnce·runClaudeCLIStreamOnce·execCodex)에서
// 획득한다(2026-08-30) — 예전엔 generateText 만 캡을 지나서, runClaudeCLI 를 직접
// import 하는 ~30 호출처가 전부 캡을 우회했다. 이제 어느 문으로 들어와도 스폰 직전에
// 반드시 이 슬롯을 지난다. 호출처는 withCliSlot 을 직접 쓸 일이 없다.
//
// ⚠ 중첩 획득 금지: 슬롯을 쥔 채(트랜스포트 콜백 안에서) 또 다른 CLI 호출을 await
// 하면 포화 상태에서 교착한다. 폴백(claude 실패 → codex)은 첫 슬롯이 reject 로
// 풀린 뒤 순차 획득이라 안전하다.
//
// AI_CLI_MAX_PARALLEL 로 조절(기본 5 — 전 호출처가 캡을 지나게 되면서 3은 긴 생성
// 뒤 대기가 과해져 2026-08-30에 상향).

import { AsyncLocalStorage } from "node:async_hooks";

const MAX = Math.max(1, Number(process.env.AI_CLI_MAX_PARALLEL) || 5);

// dev 핫 리로드가 모듈을 갈아끼워도 카운터가 이어지도록 globalThis 에 둔다
// (jobs/in-flight.ts 와 같은 규칙 — 모듈 변수면 리로드 순간 active 가 0 으로
// 리셋돼 캡이 순간적으로 2배가 된다).
type SlotState = { active: number; waiters: Array<() => void> };
const g = globalThis as typeof globalThis & { __aiCliSlots?: SlotState };
const state: SlotState = (g.__aiCliSlots ??= { active: 0, waiters: [] });

// ── 칸(lane) (2026-10-02 henry "20개가 한 번에") ──
// 스레드 답 미리 쓰기는 보는 곳 20개를 한꺼번에 쓴다. 전체 캡(5)을 올리면 대시보드 모든 기능의 팬아웃이 같이 풀리므로,
// 그 호출들만 자기 칸(runInCliLane)에서 따로 센다. 칸은 AsyncLocalStorage 로 따라가서 호출처 시그니처를 바꾸지 않는다.
type Lane = { name: string; max: number };
const laneStore: AsyncLocalStorage<Lane> = ((g as typeof g & { __aiCliLaneStore?: AsyncLocalStorage<Lane> }).__aiCliLaneStore ??= new AsyncLocalStorage<Lane>());
const laneStates: Map<string, SlotState> = ((g as typeof g & { __aiCliLanes?: Map<string, SlotState> }).__aiCliLanes ??= new Map());

/** fn 안에서 시작한 CLI 호출은 name 칸(동시 max 개)을 쓴다 */
export function runInCliLane<T>(name: string, max: number, fn: () => Promise<T>): Promise<T> {
  return laneStore.run({ name, max: Math.max(1, Math.floor(max)) }, fn);
}

function slotFor(): { st: SlotState; max: number } {
  const lane = laneStore.getStore();
  if (!lane) return { st: state, max: MAX };
  let st = laneStates.get(lane.name);
  if (!st) laneStates.set(lane.name, (st = { active: 0, waiters: [] }));
  return { st, max: lane.max };
}

/** 슬롯을 얻을 때까지 대기한 뒤 fn 을 실행하고, 끝나면 다음 대기자를 깨운다. 칸 안이면 그 칸에서 센다. */
export async function withCliSlot<T>(fn: () => Promise<T>): Promise<T> {
  const { st, max } = slotFor();
  if (st.active >= max) {
    await new Promise<void>((resolve) => st.waiters.push(resolve));
  }
  st.active += 1;
  try {
    return await fn();
  } finally {
    st.active -= 1;
    const next = st.waiters.shift();
    if (next) next();
  }
}

/**
 * 슬롯을 **획득한 뒤** 실효 타임아웃을 계산한다. 대기가 예산(deadlineMs)을 먹었으면
 * 그만큼 깎이고, 다 먹었으면 시작도 하지 않는다(어차피 못 끝낼 호출로 슬롯을 태우지
 * 않는다). 반드시 withCliSlot 콜백 안(대기가 끝난 시점)에서 호출할 것.
 */
export function effectiveTimeoutAfterSlot(
  timeoutMs: number,
  deadlineMs?: number
): number {
  if (deadlineMs === undefined) return timeoutMs;
  const left = deadlineMs - Date.now();
  if (left <= 0) {
    throw new Error("AI 호출 시간 초과(예산 소진, 슬롯 대기 중 마감)");
  }
  return Math.min(timeoutMs, left);
}
