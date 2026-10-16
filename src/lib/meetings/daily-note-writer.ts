import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import type { MeetingAnalysis } from "./types";
import { isValidDateKey, isValidPersonName } from "./validate";

const SECTION_HEADING = "## 만남 기록";

/** 데일리노트 디렉터리 — vaultPath 가 비어 있으면 빈 문자열(가드는 호출부 책임). */
function dailyNotesDir(vaultPath?: string): string {
  const root = vaultPath ?? config.obsidian.vaultPath;
  return path.join(root, "30_Daily_Notes");
}

function dailyNotePath(date: string, vaultPath?: string): string {
  return path.join(dailyNotesDir(vaultPath), `${date}.md`);
}

/**
 * 회의 식별자 멱등 마커. met:: 라인 끝에 HTML 주석으로 붙는다.
 * - dataviewjs 정규식 그룹2(headline)에 함께 잡히지만, Obsidian MarkdownRenderer 는
 *   HTML 주석을 렌더하지 않으므로 타임라인 출력에는 보이지 않는다.
 * - 같은 회의를 재처리하면 이 마커로 기존 블록을 찾아 교체한다(중복 방지).
 */
function marker(meetingId: string): string {
  return `<!-- mtg:${meetingId} -->`;
}

/**
 * (PURE) met:: 블록 마크다운을 만든다.
 *
 *   met:: [[사람]] <headline> <!-- mtg:<id> -->
 *   - <bullet>
 *   - <bullet>
 *   <빈 줄>
 *
 * bullets 는 keyPoints → decisions → actionItems 순으로 간결하게 모은다.
 * 빈 줄로 종료해 인물 노트 dataviewjs 의 bullet 수집 종료 조건을 만족시킨다.
 */
export function renderMetBlock(
  person: string,
  analysis: MeetingAnalysis,
  meetingId: string
): string {
  const bullets: string[] = [];
  for (const k of analysis.keyPoints) bullets.push(k);
  if (analysis.decisions) for (const d of analysis.decisions) bullets.push(d);
  if (analysis.actionItems) {
    for (const a of analysis.actionItems) {
      // "나"(녹음한 본인)는 데일리노트 맥락상 자명하므로 접두어를 생략한다.
      // 그 외(상대/지명)는 누가 할 일인지 짧게 남긴다.
      const prefix = a.owner && a.owner !== "나" ? `${a.owner}: ` : "";
      bullets.push(`${prefix}${a.task}`);
    }
  }

  const lines: string[] = [];
  lines.push(`met:: [[${person}]] ${analysis.headline} ${marker(meetingId)}`);
  for (const b of bullets) lines.push(`- ${b}`);
  // 빈 줄로 블록을 종료(수집 종료 조건). 끝에 개행 1개 추가.
  return lines.join("\n") + "\n\n";
}

export interface WriteMeetingOpts {
  /** YYYY-MM-DD. */
  date: string;
  person: string;
  analysis: MeetingAnalysis;
  meetingId: string;
  /** 테스트 격리용. 없으면 config(OBSIDIAN_VAULT_PATH) 사용. */
  vaultPath?: string;
}

/** 최소 데일리노트 골격(파일이 없을 때만). 전체 템플릿을 위조하지 않는다. */
function minimalDailyNote(date: string): string {
  return `# ${date}\n\n${SECTION_HEADING}\n`;
}

/**
 * 한 met:: 블록의 라인 범위 [start, end) 를 찾는다.
 * - start: met:: 라인 인덱스
 * - end: 블록 종료(빈 줄 / --- / "## " / 다음 met:: 직전)까지의 exclusive 인덱스
 * 멱등 키는 (person, meetingId): 같은 사람+같은 회의일 때만 기존 블록을 교체한다.
 * 다중 참석자는 같은 meetingId 라도 사람마다 별도 블록을 갖는다.
 */
function findBlockByMarker(
  lines: string[],
  person: string,
  meetingId: string
): { start: number; end: number } | null {
  const mk = marker(meetingId);
  const personPrefix = `met:: [[${person}]]`;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(personPrefix)) continue;
    if (!lines[i].includes(mk)) continue;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "") break;
      if (t === "---") break;
      if (t.startsWith("## ")) break;
      if (t.startsWith("met:: ")) break;
      // 블록은 met:: 라인 + 이어지는 bullet 들로만 구성된다.
      if (!lines[j].startsWith("- ")) break;
    }
    return { start: i, end: j };
  }
  return null;
}

/**
 * 데일리노트의 `## 만남 기록` 섹션에 met:: 블록을 멱등 삽입한다.
 * - 같은 meetingId+person 으로 재실행하면 기존 블록을 교체(중복 없음).
 * - 다른 회의면 섹션 끝에 새 블록을 덧붙인다.
 * - 파일이 없으면 최소 골격으로 생성(전체 템플릿 위조 금지).
 * - 섹션이 없으면 파일 끝에 섹션을 만들어 붙인다.
 * 새 폴더는 만들지 않는다(30_Daily_Notes 만 보장).
 */
export async function writeMeetingToDailyNote(
  opts: WriteMeetingOpts
): Promise<void> {
  const { date, person, analysis, meetingId, vaultPath } = opts;
  if (!isValidDateKey(date)) throw new Error(`invalid date: ${date}`);
  if (!isValidPersonName(person)) {
    throw new Error(`invalid person name: ${person}`);
  }
  const filePath = dailyNotePath(date, vaultPath);

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    content = minimalDailyNote(date);
  }

  const block = renderMetBlock(person, analysis, meetingId);
  const blockLines = block.replace(/\n+$/, "").split("\n");
  let lines = content.split("\n");

  // 1) 같은 사람+같은 회의의 기존 블록이 있으면 그 자리에서 교체(멱등).
  const existing = findBlockByMarker(lines, person, meetingId);
  if (existing) {
    lines.splice(existing.start, existing.end - existing.start, ...blockLines);
    await fs.mkdir(dailyNotesDir(vaultPath), { recursive: true });
    await fs.writeFile(filePath, lines.join("\n"), "utf-8");
    return;
  }

  // 2) 섹션 위치를 찾는다(없으면 만든다).
  const sectionIdx = lines.findIndex((l) => l.trim() === SECTION_HEADING);
  if (sectionIdx === -1) {
    // 섹션이 없으면 파일 끝에 섹션 + 블록을 붙인다.
    const tail: string[] = [];
    if (lines.length && lines[lines.length - 1].trim() !== "") tail.push("");
    tail.push(SECTION_HEADING, "", ...blockLines, "");
    lines = [...lines, ...tail];
  } else {
    // 섹션의 끝(다음 "## " 또는 파일 끝) 직전에 블록을 삽입한다.
    let insertAt = lines.length;
    for (let i = sectionIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) {
        insertAt = i;
        break;
      }
    }
    // 삽입 지점 앞의 빈 줄들을 건너뛰지 않고, 블록 + 빈 줄 1개로 깔끔히 끼운다.
    const toInsert = [...blockLines, ""];
    // 섹션 헤딩 바로 다음에 빈 줄이 없으면 하나 보장.
    const headingFollowedByBlank =
      sectionIdx + 1 < lines.length && lines[sectionIdx + 1].trim() === "";
    if (!headingFollowedByBlank) toInsert.unshift("");
    lines.splice(insertAt, 0, ...toInsert);
  }

  await fs.mkdir(dailyNotesDir(vaultPath), { recursive: true });
  await fs.writeFile(filePath, lines.join("\n"), "utf-8");
}
