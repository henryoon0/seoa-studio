// 발송 대기줄 공통 안전 규칙 (GLOSSARY.md 발송 대기줄). 채널마다 줄 모양은 달라도 이 규칙은 같다.
// 순수 — I/O 없음.
//   ① 연속 실패 멈춤: 토큰 만료처럼 전부 실패하는 장애에서 같은 오류를 계속 내지 않는다.
//   ② 끊긴 발송 정리: 보내던 중 앱이 꺼진 건은 다시 보내지 않는다(두 번 달림 방지).

export const MAX_CONSECUTIVE_FAILURES = 3;

/** 멈춤 때문에 실패 처리된 건의 kind. 실제 시도가 아니라 연속 실패에 세지 않는다. */
export const STOPPED_KIND = "stopped";

export const STOPPED_MESSAGE = `연속 ${MAX_CONSECUTIVE_FAILURES}건 실패로 자동 정지했어요. 토큰 만료 등 전체 문제일 수 있어요.`;

export const INTERRUPTED_MESSAGE = "보내는 중에 앱이 꺼졌어요. 달렸는지 확인하고, 안 달렸으면 다시 보내 주세요.";

interface Attempt {
  status: string;
  kind?: string;
}

/** 마지막 성공 뒤로 이어진 실패 수. 항목 순서 = 시도 순서. 아직 시도 전인 건과 멈춤 처리 건은 건너뛴다. */
export function consecutiveFailures(items: readonly Attempt[]): number {
  let n = 0;
  for (let k = items.length - 1; k >= 0; k--) {
    const i = items[k];
    if (i.status === "sent") break;
    if (i.status === "failed" && i.kind !== STOPPED_KIND) n++;
  }
  return n;
}

export function tooManyFailures(items: readonly Attempt[]): boolean {
  return consecutiveFailures(items) >= MAX_CONSECUTIVE_FAILURES;
}

/** 보내던 중(sending) 끊긴 건의 결과를 정한다. 다시 보내지 않는다. */
export function settleInterrupted<T extends { status: string }>(
  items: readonly T[],
  alreadySent: (item: T) => boolean,
  settle: (item: T, result: "sent" | "unknown") => T
): T[] {
  return items.map((i) => (i.status === "sending" ? settle(i, alreadySent(i) ? "sent" : "unknown") : i));
}
