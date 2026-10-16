import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { localDateKey } from "@/lib/date";
import { isValidPersonName } from "./validate";

/** 인물 노트 디렉터리. 새 폴더는 만들지 않는다(기존 50_People 만 사용). */
function peopleDir(vaultPath?: string): string {
  const root = vaultPath ?? config.obsidian.vaultPath;
  return path.join(root, "50_People");
}

function personNotePath(name: string, vaultPath?: string): string {
  return path.join(peopleDir(vaultPath), `${name}.md`);
}

/**
 * 만남 히스토리 dataviewjs — 기존 인물 노트에서 그대로 복사(VERBATIM).
 * vault 규칙상 새 dataview 를 작성하지 않고 기존 코드를 재사용한다.
 */
const MEETING_HISTORY_DATAVIEWJS = `## 만남 히스토리 (자동 생성)
\`\`\`dataviewjs
// 만남 히스토리: met::[[이 사람]] 헤드라인 다음에 오는 bullets(목표/핵심/액션)도 함께 추출.
// 라인 기반인 기본 Dataview 한계를 우회하기 위해 raw 파일 내용을 직접 읽음.

const { MarkdownRenderer, Component } = require("obsidian");

const currentPerson = dv.current().file.name;

const candidates = dv.pages('"30_Daily_Notes"')
    .sort(p => p.file.name, 'desc');

const entries = [];

for (const page of candidates) {
    const file = app.vault.getAbstractFileByPath(page.file.path);
    if (!file) continue;

    const content = await app.vault.cachedRead(file);
    const lines = content.split('\\n');

    for (let i = 0; i < lines.length; i++) {
        // Match: met::[[이름]] 또는 met::[[이름|alias]] 헤드라인
        const m = lines[i].match(/^met::\\s*\\[\\[([^\\]|]+)(?:\\|[^\\]]*)?\\]\\]\\s*(.*)$/);
        if (!m) continue;
        if (m[1].trim() !== currentPerson) continue;

        const headline = m[2].trim();
        const body = [];

        // 다음 빈 줄 / hard stop 전까지 bullets 수집
        for (let j = i + 1; j < lines.length; j++) {
            const next = lines[j];
            const trimmed = next.trim();
            if (trimmed === '') break;
            if (trimmed === '---') break;
            if (trimmed.startsWith('## ')) break;
            if (trimmed.startsWith('met::')) break;
            body.push(next);
        }

        entries.push({
            dateLink: page.file.link,
            headline: headline,
            body: body.join('\\n')
        });
    }
}

// Helper: render markdown via Obsidian, handling both old & new API signatures.
async function renderMd(md, container) {
    const component = dv.component || new Component();
    const path = dv.currentFilePath || "";
    if (typeof MarkdownRenderer.render === "function") {
        // Obsidian 1.x newer signature
        await MarkdownRenderer.render(app, md, container, path, component);
    } else {
        // Older signature
        await MarkdownRenderer.renderMarkdown(md, container, path, component);
    }
}

if (entries.length === 0) {
    dv.paragraph("아직 만남 기록이 없습니다.");
} else {
    for (const entry of entries) {
        const md = (entry.body
            ? \`**\${entry.headline}**\\n\${entry.body}\`
            : \`**\${entry.headline}**\`);

        dv.header(4, entry.dateLink);
        const container = dv.container.createDiv({cls: 'meeting-entry'});
        await renderMd(md, container);
    }
}
\`\`\``;

/** 인물 노트 템플릿 — 기존 인물 노트 골격(frontmatter/기본 섹션 + 만남 히스토리 dataviewjs). */
function personNoteTemplate(name: string): string {
  return `---
tags:
  - people
created: ${localDateKey()}
---
# ${name}

## 기본 정보
- **이름:**
- **관계:**

## 관심사 & 특징
-

## 메모
-

${MEETING_HISTORY_DATAVIEWJS}

## 관련 노트
-

---
`;
}

/**
 * 50_People 의 인물 노트 basename 목록(자동완성용). 디렉터리가 없으면 빈 배열.
 */
export async function listPeopleNames(opts?: {
  vaultPath?: string;
}): Promise<string[]> {
  if (!(opts?.vaultPath ?? config.obsidian.vaultPath)) return [];
  try {
    const files = await fs.readdir(peopleDir(opts?.vaultPath));
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort((a, b) => a.localeCompare(b, "ko"));
  } catch {
    return [];
  }
}

/**
 * 인물 노트를 보장한다.
 * - 50_People/{name}.md 가 있으면 무변경(byte-identical) → { created: false }.
 * - 없으면 기존 인물 노트 골격 템플릿으로 생성 → { created: true }.
 * 절대 기존 노트를 덮어쓰지 않는다. 새 폴더는 만들지 않는다(50_People 만 보장).
 */
export async function ensurePersonNote(
  name: string,
  opts?: { vaultPath?: string }
): Promise<{ created: boolean }> {
  if (!isValidPersonName(name)) {
    throw new Error(`invalid person name: ${name}`);
  }
  const filePath = personNotePath(name, opts?.vaultPath);
  try {
    await fs.access(filePath);
    return { created: false };
  } catch {
    // 존재하지 않음 → 생성.
  }
  await fs.mkdir(peopleDir(opts?.vaultPath), { recursive: true });
  await fs.writeFile(filePath, personNoteTemplate(name), "utf-8");
  return { created: true };
}
