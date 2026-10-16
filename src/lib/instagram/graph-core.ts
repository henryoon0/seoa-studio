// Instagram/Facebook Graph API 공통 코어 — base URL 상수 + 에러 분류기.
//
// 호스트는 진짜로 2개다 (합치면 안 됨):
//   - graph.instagram.com  = Instagram Login 경로 (댓글·DM·발행, 우리 토큰 대부분)
//   - graph.facebook.com   = Facebook Login 경로 (AICC Discovery 앱의 business_discovery 전용)
//
// ── 분류 규칙 통합표 (2026-08-30, 각 경로의 기존 판정 → 공유 판정) ─────────────
//
// | 신호                                  | engine(isTransientSendError) | publish/instagram(isFatal) | 공유 판정   |
// |---------------------------------------|------------------------------|----------------------------|-------------|
// | 타임아웃 문구("응답이 N초…")           | transient(재시도)            | (해당 없음)                | transient   |
// | fetch failed/network/ECONNRESET/       | transient                    | (문자열 검사 없음)         | transient   |
// |   ETIMEDOUT/socket/aborted             |                              |                            |             |
// | HTTP 5xx ("Instagram API 5xx" 문구)    | transient                    | 비-fatal(루프가 재시도)    | transient   |
// | HTTP 401/403                           | 비-transient(재시도 안 함)   | fatal                      | fatal       |
// | error.code 190/10/200 (토큰·권한·정책) | 비-transient                 | fatal                      | fatal       |
// | error.type OAuthException              | 비-transient                 | ⚠비-fatal(루프가 재시도)   | fatal ← 변경|
// | 그 외 알 수 없는 에러                  | 비-transient(재시도 안 함)   | 비-fatal(루프가 재시도)    | ⚠기본값 상이|
//
// ⚠ OAuthException: publish/threads.ts 는 원래 fatal 로 봤고, 인증 에러는 몇 초 재시도로
//   안 살아난다. 안전한 쪽(fatal = 재발송 없음)으로 통일 — publish/instagram 만 판정이 바뀐다.
// ⚠ 알 수 없는 에러의 기본값은 경로마다 달라야 한다:
//   - engine 의 재시도는 팔로워에게 "한 번 더 보내기"라 중복 발송 위험 → 기본 fatal(재시도 금지)
//     이 안전값이고, classifyIgError 는 이 기본값을 쓴다.
//   - publish 의 attempt 루프는 "컨테이너가 아직 처리 중" 같은 무명 400 을 몇 초 뒤 되묻는
//     장치라, 기본 fatal 로 바꾸면 캐러셀 발행 자체가 죽는다 → publish 는 classifyIgError 의
//     기본값 대신 isKnownFatalIgError(알려진 fatal 신호만) 로 .fatal 을 만든다.

export const IG_GRAPH_BASE = "https://graph.instagram.com/v25.0";
export const FB_GRAPH_BASE = "https://graph.facebook.com/v25.0";

export interface IgErrorInput {
  /** 저장된 에러 문구 (엔진 원장 entry.error 등) */
  message?: string;
  /** HTTP 상태 코드 (응답을 직접 들고 있는 호출처만) */
  status?: number;
  /** Graph 에러 응답 원문 JSON — error.code / error.type 을 꺼낸다 */
  body?: string;
}

/** 일시 장애 문구 — engine.isTransientSendError 의 목록을 그대로 옮겼다 (판정 불변). */
const TRANSIENT_MESSAGE =
  /응답이 \d+초 안에 오지 않았어요|fetch failed|network|ECONNRESET|ETIMEDOUT|socket|aborted|Instagram API 5\d\d/i;

/** 재시도해도 절대 안 살아나는 Graph 에러 코드 (190=토큰, 10=권한, 200=권한/정책). */
const FATAL_GRAPH_CODES = new Set([190, 10, 200]);

function parseGraphError(body: string | undefined): { code?: number; type?: string } {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; type?: string } };
    return { code: parsed.error?.code, type: parsed.error?.type };
  } catch {
    return {};
  }
}

/** 알려진 영구 실패 신호만 true. 알 수 없는 에러는 false (호출처가 기본값을 정한다). */
export function isKnownFatalIgError(input: IgErrorInput): boolean {
  if (input.status === 401 || input.status === 403) return true;
  const { code, type } = parseGraphError(input.body);
  if (code !== undefined && FATAL_GRAPH_CODES.has(code)) return true;
  return type === "OAuthException";
}

/** 알려진 일시 장애 신호만 true (타임아웃·네트워크 단절·5xx). */
export function isKnownTransientIgError(input: IgErrorInput): boolean {
  if (input.status !== undefined && input.status >= 500) return true;
  return input.message !== undefined && TRANSIENT_MESSAGE.test(input.message);
}

/**
 * 재발송 판정용 분류기. transient = 재시도해도 되는 일시 장애.
 * 알 수 없는 에러는 fatal — 재시도는 팔로워에게 실제 발송이 한 번 더 나가는 일이라,
 * "안 보내는 실수"가 "두 번 보내는 실수"보다 싸다 (기존 engine 기본값과 동일).
 * fatal 검사를 먼저 한다: 신호가 겹치면(예: 401 + 네트워크 문구) 안전한 쪽이 이긴다.
 */
export function classifyIgError(input: IgErrorInput): "transient" | "fatal" {
  if (isKnownFatalIgError(input)) return "fatal";
  if (isKnownTransientIgError(input)) return "transient";
  return "fatal";
}
