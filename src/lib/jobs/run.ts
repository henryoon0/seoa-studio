// ── Job Runner: fire-and-forget 백그라운드 잡의 생명주기를 모으는 deep 모듈 ──
//
// 같은 패턴(배타적 실행 가드 + active/error 상태 전이 + 고아 감지)이 자막·영상·
// content-ideas 등에 손으로 중복돼 있고 "도는 중에 갇힘" 사고가 반복됐다. 그 공통
// 골격을 작은 인터페이스 뒤에 둔다 — status 값·저장 방식은 어댑터(phase)가 정한다.

/** 한 phase 의 실행 계약. status 를 어디에 어떻게 쓰는지는 어댑터가 안다. */
export interface JobPhase<T> {
  /** 배타적 실행 키 — 같은 키는 동시에 한 번만 돈다. */
  key: string;
  /** 시작 표시: active 상태로 전이 + 직전 error 클리어. 돌 게 없으면 null(스킵). */
  begin: () => Promise<T | null>;
  /** 작업 본체. begin 의 컨텍스트를 받고, 성공 시 terminal 상태를 직접 쓴다. */
  work: (ctx: T) => Promise<void>;
  /** 실패 표시: 복구 가능 상태로 전이 + error 기록. */
  fail: (message: string) => Promise<void>;
}

// 이 프로세스에서 실제로 도는 phase 들. 고아 감지("status 는 active 인데 안 돈다")의 한 축.
//
// ⚠globalThis 에 둔다 — dev(Turbopack) hot-reload 가 이 모듈을 재평가하면 모듈 레벨
// Set 은 새로 만들어져 가드가 통째로 풀린다. 그러면 이미 도는 잡을 sweep/폴링이
// "안 돌고 있다"고 오판해 **중복 실행**한다 (2026-07-15 실측: 렌더 중에 cut 파일을
// 편집 → 재컴파일 → 두 번째 ffmpeg 가 같은 출력 파일에 붙어 인코딩이 4배 느려짐).
// 같은 이유로 sweep.ts 의 스케줄러도 globalThis 를 쓴다.
function runningSet(): Set<string> {
  const g = globalThis as typeof globalThis & { __jobRunning?: Set<string> };
  g.__jobRunning ??= new Set<string>();
  return g.__jobRunning;
}

/** 이 프로세스에서 해당 key 의 phase 가 실제로 도는 중인지. */
export function isRunning(key: string): boolean {
  return runningSet().has(key);
}

/** 지금 도는 phase 키들 — 진단·테스트 격리용. */
export function runningJobKeys(): readonly string[] {
  return [...runningSet()];
}

/**
 * 도는 phase 가 전부 끝날 때까지 기다린다.
 *
 * 테스트 격리에 필요하다: fire-and-forget 잡이 살아 있는 채로 저장 디렉터리를
 * 지우면, 그 잡은 죽지 않고 **다음 테스트의 디렉터리**에 쓴다(dirStore·audio-store 는
 * 경로를 호출 시점 env 로 해석한다). 실패가 매번 다른 테스트에서 튀는 원인이었다.
 */
export async function waitForJobsToDrain(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (runningSet().size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * phase 를 배타적으로 실행한다.
 * - 같은 key 가 이미 돌면 즉시 무시(중복 실행 방지).
 * - begin → work 흐름. work 가 던지면 fail 로 넘겨 복구 가능 상태로 떨어뜨린다
 *   (절대 active 상태에 갇히지 않게).
 * - begin 이 null 이면 돌 게 없는 것 — work/fail 둘 다 건너뛴다.
 */
export async function runPhase<T>(phase: JobPhase<T>): Promise<void> {
  const running = runningSet();
  if (running.has(phase.key)) return;
  running.add(phase.key);
  try {
    const ctx = await phase.begin();
    if (ctx === null) return;
    try {
      await phase.work(ctx);
    } catch (e) {
      await phase.fail(e instanceof Error ? e.message : String(e));
    }
  } finally {
    running.delete(phase.key);
  }
}
