export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftLocalDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

// 로컬 시각 키 "YYYY-MM-DDTHH:MM:SS". localDateKey 와 앞 10자가 같아 사전순 비교로
// 날짜 키와 나란히 정렬된다(수집 카드의 savedAt 처럼 하루 안 순서를 가릴 때 쓴다).
export function localTimestampKey(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${localDateKey(date)}T${hh}:${mm}:${ss}`;
}

export function isLocalTimestampKey(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
  );
}

export function isLocalDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function normalizeLocalDateKey(value: unknown, fallback = localDateKey()): string {
  return isLocalDateKey(value) ? value : fallback;
}
