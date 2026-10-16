import { config } from "@/lib/config";
import { getMeeting, updateMeeting } from "./store";
import { writeMeetingToDailyNote } from "./daily-note-writer";
import { ensurePersonNote } from "./person-note";
import type { Meeting } from "./types";

/** 빈 문자열/중복 제거 + 트림. 입력 순서는 보존한다. */
function normalizePeople(people: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of people) {
    const name = (raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * 회의에 참석자(상대)를 태깅한다.
 * - meeting.people 를 저장한다(항상).
 * - status 가 "ready" 이고 analysis 가 있을 때만 vault 에 기록한다:
 *   사람마다 인물 노트 보장(없으면 생성) + 그날 데일리노트에 met:: 블록 멱등 삽입.
 * - OBSIDIAN_VAULT_PATH 가 비어 있으면 vault 기록을 건너뛴다(throw 하지 않음).
 * 알 수 없는 id 면 null.
 */
export async function tagMeetingPeople(
  meetingId: string,
  people: string[]
): Promise<Meeting | null> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return null;

  const normalized = normalizePeople(people);
  const updated = await updateMeeting(meetingId, { people: normalized });
  if (!updated) return null;

  const canWriteVault =
    Boolean(config.obsidian.vaultPath) &&
    updated.status === "ready" &&
    Boolean(updated.analysis);

  if (canWriteVault && updated.analysis) {
    for (const person of normalized) {
      await ensurePersonNote(person);
      await writeMeetingToDailyNote({
        date: updated.date,
        person,
        analysis: updated.analysis,
        meetingId: updated.id,
      });
    }
  }

  return updated;
}
