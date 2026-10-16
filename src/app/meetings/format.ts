import type { Meeting } from "@/lib/meetings/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-06-08" → 로컬 자정 Date(UTC 파싱이 날짜를 하루 당기는 걸 막는다). */
function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** "2026-06-08" → { date: "2026.06.08", weekday: "월요일" }. */
export function dividerLabel(ymd: string): { date: string; weekday: string } {
  const dt = parseLocalDate(ymd);
  return { date: ymd.replace(/-/g, "."), weekday: `${WEEKDAYS[dt.getDay()]}요일` };
}

/** ISO → "오후 5:11". 파싱 실패 시 빈 문자열. */
export function timeLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * 날짜별로 묶어 최신 날짜부터 나열한다. 같은 날짜 안에서는 createdAt 내림차순,
 * createdAt이 없으면 입력 순서를 유지한다(sort는 stable).
 * 입력 순서를 믿지 않는다 — API가 날짜를 섞어 보내도 화면은 항상 날짜순.
 */
export function groupByDate<
  T extends Pick<Meeting, "date"> & Partial<Pick<Meeting, "createdAt">>,
>(meetings: T[]): { date: string; items: T[] }[] {
  const groups: { date: string; items: T[] }[] = [];
  const index = new Map<string, number>();
  for (const m of meetings) {
    let i = index.get(m.date);
    if (i === undefined) {
      i = groups.length;
      index.set(m.date, i);
      groups.push({ date: m.date, items: [] });
    }
    groups[i].items.push(m);
  }
  groups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const group of groups) {
    group.items.sort((a, b) =>
      (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
    );
  }
  return groups;
}
