/**
 * 입력 검증 — 파일시스템 경로에 들어가는 사용자 제어 값(회의 id, 사람 이름, 날짜)을
 * FS 접근 전에 막아 경로 탈출(path traversal)을 차단한다.
 * id 는 URL 파라미터, 사람 이름은 태깅 API body 에서 오므로 신뢰할 수 없다.
 */

/** 회의 id 는 randomUUID(v4 형식)만 허용. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidMeetingId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/**
 * 사람 이름(= 50_People/{name}.md 파일명, met:: 링크명).
 * 글자/숫자/공백/._- 만 허용, 1~64자. 경로 구분자·`..` 는 명시적으로 거부.
 */
const PERSON_RE = /^[\p{L}\p{N} _.\-]{1,64}$/u;

export function isValidPersonName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    PERSON_RE.test(name) &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

/** 데일리노트 파일명 키. YYYY-MM-DD 만 허용. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(d: unknown): d is string {
  return typeof d === "string" && DATE_RE.test(d);
}
