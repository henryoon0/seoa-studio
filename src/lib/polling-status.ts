// 폴링이 실패했을 때 "무슨 일이고 어떻게 대응하나"를 한 곳에서 판정한다.
// 화면 87곳이 각자 에러를 삼키는 대신, 여기로 보고하고 <ConnectionNotice /> 가
// 하나만 띄운다. 진단 문구는 비개발자가 읽고 바로 행동할 수 있게 쓴다.
//
// 색 SSOT 는 toast.tsx 와 같다 (오류=rose). 모듈 레벨 pub/sub 도 같은 패턴.

export type PollingProblemKind =
  | "offline"
  | "server-down"
  | "server-error"
  | "timeout"
  | "not-found"
  | "unknown";

export interface PollingProblem {
  kind: PollingProblemKind;
  /** 무슨 일이 일어났는지. 한 문장. */
  title: string;
  /** henry 가 지금 할 수 있는 행동. 한두 문장. */
  action: string;
  /** 터미널에 그대로 붙여넣을 명령어. 없으면 undefined. */
  command?: string;
}

/** 폴링 중 fetch 가 !ok 일 때 던질 에러. 상태 코드를 보존한다. */
export class PollingHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`${status} ${url}`);
    this.name = "PollingHttpError";
  }
}

/**
 * usePolling 안에서 쓰는 fetch. 응답이 실패면 조용히 return 하지 않고 던진다.
 * 호출처가 `if (!res.ok) return;` 으로 삼키면 안내판이 아무것도 모른다.
 */
export async function pollFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) throw new PollingHttpError(res.status, String(input));
  return res;
}

export function describePollingError(error: unknown): PollingProblem {
  // 맥이 아예 오프라인. 서버 탓이 아니다.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      kind: "offline",
      title: "맥이 인터넷에 연결돼 있지 않아요.",
      action: "와이파이를 확인해 주세요. 연결되면 화면이 저절로 돌아옵니다.",
    };
  }

  if (error instanceof PollingHttpError) {
    if (error.status === 404) {
      return {
        kind: "not-found",
        // 이 저장소의 실패 기록: "새 라우트만 404" 는 코드가 아니라
        // .next 캐시 오염이 원인인 경우가 반복됐다.
        title: "서버가 이 주소를 못 찾고 있어요.",
        action:
          "빌드 캐시가 꼬였을 때 나오는 증상입니다. dev 서버를 다시 켜면 대개 풀려요.",
        command: "npm run dev",
      };
    }
    if (error.status === 504 || error.status === 408) {
      return {
        kind: "timeout",
        title: "서버가 제때 답을 못 하고 있어요.",
        action:
          "무거운 작업(자막 번역, 초안 생성 등)이 돌고 있을 수 있습니다. 잠시 기다려 보시고, 계속 이러면 .dev.log 를 확인해 주세요.",
      };
    }
    if (error.status >= 500) {
      return {
        kind: "server-error",
        title: "서버에서 오류가 났어요.",
        action:
          "화면 잘못이 아니라 서버 코드에서 터진 겁니다. 아래 명령으로 마지막 오류를 확인할 수 있어요.",
        command: "tail -40 .dev.log",
      };
    }
  }

  // fetch 자체가 거부됨(TypeError: Failed to fetch). 온라인인데 못 닿으면
  // 이 대시보드에서는 거의 항상 dev 서버가 꺼진 경우다.
  if (error instanceof TypeError) {
    return {
      kind: "server-down",
      title: "대시보드 서버가 꺼져 있어요.",
      action:
        "터미널에서 서버를 다시 켜면 됩니다. 켜지는 대로 이 안내는 사라져요.",
      command: "npm run dev",
    };
  }

  return {
    kind: "unknown",
    title: "화면 갱신이 안 되고 있어요.",
    action:
      "원인을 특정하지 못했습니다. 새로고침을 해보시고, 그래도 안 되면 .dev.log 를 확인해 주세요.",
    command: "tail -40 .dev.log",
  };
}

// ── 상태 저장소 ────────────────────────────────────────────────
// 여러 화면이 동시에 실패해도 안내판은 하나. 가장 먼저 보고된 문제를 보여주고,
// 실패한 화면이 전부 회복되면 사라진다.

export interface PollingStatus {
  problem: PollingProblem | null;
  /** 지금 실패 중인 폴링 개수. 0 이면 정상. */
  failingCount: number;
  /**
   * 장애 회차. 정상 → 장애로 넘어갈 때마다 1 씩 오른다.
   * "이 회차는 닫았다"를 기억하는 데 쓴다 — 다음 장애는 다시 알려야 하므로
   * 닫힘 상태를 effect 로 되돌리지 않고 회차 비교로 계산한다.
   */
  episode: number;
}

const failing = new Map<string, PollingProblem>();
const listeners = new Set<(s: PollingStatus) => void>();
let episode = 0;

function snapshot(): PollingStatus {
  const first = failing.values().next();
  return {
    problem: first.done ? null : first.value,
    failingCount: failing.size,
    episode,
  };
}

function publish() {
  const s = snapshot();
  for (const l of listeners) l(s);
}

/** 연속 실패가 문턱을 넘었을 때 호출. 한 번 삐끗한 정도로는 부르지 않는다. */
export function reportPollingFailure(key: string, error: unknown) {
  if (failing.size === 0) episode += 1; // 정상 → 장애로 넘어가는 순간
  failing.set(key, describePollingError(error));
  publish();
}

/** 성공하면 즉시 해제. 회복은 자동이어야 한다. */
export function clearPollingFailure(key: string) {
  if (failing.delete(key)) publish();
}

export function subscribePollingStatus(fn: (s: PollingStatus) => void) {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}

/** 테스트 전용. */
export function __resetPollingStatus() {
  failing.clear();
  publish();
}
