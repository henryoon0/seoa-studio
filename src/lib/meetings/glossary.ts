// 회의 용어집 — 사용자가 직접 고치는 마크다운 한 장(data/meetings/glossary.md).
// 줄 형식: "올바른 표기: 잘못 들린 표기, 잘못 들린 표기". 콜론이 없으면 용어만.
// - 올바른 표기 → 전사 엔진의 keyterms(처음부터 맞게 듣도록).
// - 잘못 들린 표기 → 전사 직후 치환(이름 별칭과 같은 경로).
// 개발용 도메인 문서인 GLOSSARY.md 와는 별개다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NameAlias } from "./name-aliases";

export interface MeetingGlossary {
  terms: string[];
  corrections: NameAlias[];
}

const TEMPLATE = `# 회의 용어집

회의록을 만들 때마다 이 파일을 읽습니다.
한 줄에 용어 하나: \`올바른 표기: 잘못 들린 표기, 잘못 들린 표기\`
잘못 들린 표기가 없으면 \`올바른 표기\`만 적어도 됩니다(전사 힌트로만 씀).
잘못 들린 표기는 2글자 이상만 바꿉니다.

- 심플리홈
- 단비
`;

export function glossaryPath(): string {
  const dir =
    process.env.MEETINGS_DATA_DIR ||
    path.join(process.cwd(), "data", "meetings");
  return path.join(dir, "glossary.md");
}

export function parseGlossary(markdown: string): MeetingGlossary {
  const terms: string[] = [];
  const corrections: NameAlias[] = [];
  for (const rawLine of markdown.normalize("NFC").split(/\r?\n/)) {
    if (!/^\s*[-*]\s+/.test(rawLine)) continue;
    const line = rawLine.replace(/^\s*[-*]\s+/, "").trim();
    const [head, tail = ""] = line.split(/[:：]/, 2);
    const to = head.replace(/`/g, "").trim();
    if (!to) continue;
    terms.push(to);
    for (const from of tail.split(/[,，]/).map((s) => s.trim())) {
      // to 가 from 을 품으면("김가나: 가나") 다시 돌 때마다 "김김가나"가 되므로 뺀다.
      if (from.length >= 2 && !to.includes(from)) {
        corrections.push({ from, to, createdAt: "glossary" });
      }
    }
  }
  return { terms, corrections };
}

/** 파일이 없으면 예시가 든 틀을 만들어 두고 읽는다. */
export async function loadMeetingGlossary(): Promise<MeetingGlossary> {
  const file = glossaryPath();
  let markdown: string;
  try {
    markdown = await readFile(file, "utf8");
  } catch {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, TEMPLATE, "utf8");
    markdown = TEMPLATE;
  }
  return parseGlossary(markdown);
}
