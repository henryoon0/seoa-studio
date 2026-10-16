// 발송 대기줄 화면 상태의 순수 규칙. 화면(comments-insta)과 테스트가 같이 쓴다.

export type ServerItem = { commentId: string; status: string; message: string; error?: string; attempts?: number };

export const UNKNOWN_HINT = "발송 결과를 확인하지 못했어요. 인스타에서 답글이 달렸는지 먼저 보세요.";

export const errorOf = (i: ServerItem) =>
  i.status === "failed" ? (i.error ? `발송에 실패했어요: ${i.error}` : "발송에 실패했어요. 다시 보내 보세요.")
  : i.status === "unknown" ? (i.error ?? UNKNOWN_HINT)
  : null;

/** 폴링이 결과를 계속 읽어야 하는 상태 — 화면은 이 항목을 '처리한 댓글'로 추적한다. */
const TRACKED = new Set(["queued", "sending", "sent"]);

/**
 * 담기 응답이 끊긴 뒤 서버 대기줄에서 찾은 항목을 화면 상태로 바꾼다.
 * 서버에 없으면 null(담기 실패 그대로). 있으면 서버 문구를 따르고,
 * 진행 중·보냄은 추적 목록에 넣어 이후 실패·결과 불명도 보이게 한다.
 */
export function recoverLostEnqueue(item: ServerItem | null | undefined):
  { status: string; message: string; track: boolean; error: string | null } | null {
  if (!item) return null;
  return { status: item.status, message: item.message, track: TRACKED.has(item.status), error: errorOf(item) };
}
