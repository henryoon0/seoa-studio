import fs from "fs/promises";
import { attachNoteRef, sameTodoText, splitNoteRef } from "@/lib/collab/note-link";
import { localDateKey } from "@/lib/date";

export interface Todo {
  /** Display text — the collab link token (^clb…) is split off into noteRef. */
  text: string;
  checked: boolean;
  depth: number;
  lineIndex: number;
  category?: string;
  /** Collab board link token body (e.g. "clb7f2a1") when this line is linked. */
  noteRef?: string;
  children?: Todo[];
}

const TODO_LINE_RE = /^([ \t]*)- \[([ x])\] (.*)$/;
const DAILY_HABITS_HEADING_RE = /^##\s+Daily Habits/;
const TODO_HEADING_RE = /^##\s+오늘 할 일/;
const DAILY_IMPROVEMENT_HEADING = "어제보다 나아진 한 가지";
const DAILY_IMPROVEMENT_HEADING_RE =
  /^##\s+(어제보다 나아진 한 가지|어제의 나보다 나아진 것 한가지)/;

export interface DailyImprovementEntry {
  date: string;
  text: string;
  exists: boolean;
}

function indentationDepth(indent: string): number {
  let depth = 0;
  let spaces = 0;

  for (const char of indent) {
    if (char === "\t") {
      depth += 1;
      spaces = 0;
    } else if (char === " ") {
      spaces += 1;
      if (spaces === 2) {
        depth += 1;
        spaces = 0;
      }
    }
  }

  return depth;
}

export async function parseTodos(filePath: string): Promise<Todo[]> {
  return parseTodosContent(await fs.readFile(filePath, "utf-8"));
}

/** Parses the "## 오늘 할 일" section of daily-note markdown text. */
export function parseTodosContent(content: string): Todo[] {
  const lines = content.split("\n");

  // Find "## 오늘 할 일" section
  const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
  if (sectionStart === -1) return [];

  // Find section end (next ## or end of file)
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) {
      sectionEnd = i;
      break;
    }
  }

  // Parse checkboxes within section
  const flatTodos: Todo[] = [];
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const match = lines[i].match(TODO_LINE_RE);
    if (!match) continue;

    const depth = indentationDepth(match[1]);
    const checked = match[2] === "x";
    const { clean, ref } = splitNoteRef(match[3]);

    flatTodos.push({
      text: clean,
      checked,
      depth,
      lineIndex: i,
      ...(ref ? { noteRef: ref } : {}),
    });
  }

  // Build tree structure
  const rootTodos: Todo[] = [];
  const stack: Todo[] = [];

  for (const todo of flatTodos) {
    const todoWithChildren: Todo = { ...todo, children: [] };

    if (todo.depth === 0) {
      rootTodos.push(todoWithChildren);
      stack.length = 0;
      stack.push(todoWithChildren);
    } else {
      // Find parent at depth - 1
      while (stack.length > 0 && stack[stack.length - 1].depth >= todo.depth) {
        stack.pop();
      }
      if (stack.length > 0) {
        stack[stack.length - 1].children!.push(todoWithChildren);
      }
      stack.push(todoWithChildren);
    }
  }

  // Clean up empty children arrays
  const cleanChildren = (todo: Todo): Todo => {
    if (todo.children && todo.children.length === 0) {
      return {
        text: todo.text,
        checked: todo.checked,
        depth: todo.depth,
        lineIndex: todo.lineIndex,
        ...(todo.noteRef ? { noteRef: todo.noteRef } : {}),
      };
    }
    return { ...todo, children: todo.children!.map(cleanChildren) };
  };

  return rootTodos.map(cleanChildren);
}

export async function parseHabitTodos(filePath: string): Promise<Todo[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");

  const sectionStart = lines.findIndex((line) =>
    line.match(DAILY_HABITS_HEADING_RE)
  );
  if (sectionStart === -1) return [];

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^---/) || lines[i].match(/^##\s/)) {
      sectionEnd = i;
      break;
    }
  }

  const todos: Todo[] = [];
  let category: string | undefined;

  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const categoryMatch = lines[i].trim().match(/^\*\*(.+)\*\*$/);
    if (categoryMatch) {
      category = categoryMatch[1].trim();
      continue;
    }

    const match = lines[i].match(TODO_LINE_RE);
    if (!match) continue;

    todos.push({
      text: match[3],
      checked: match[2] === "x",
      depth: indentationDepth(match[1]),
      lineIndex: i,
      category,
    });
  }

  return todos;
}

function cleanImprovementLine(line: string): string {
  return line
    .trim()
    .replace(/^- \[[ x]\]\s+/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function findSectionEnd(lines: string[], sectionStart: number): number {
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^---\s*$/) || lines[i].match(/^##\s/)) {
      sectionEnd = i;
      break;
    }
  }
  return sectionEnd;
}

export async function parseDailyImprovement(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((line) =>
    line.match(DAILY_IMPROVEMENT_HEADING_RE)
  );
  if (sectionStart === -1) return "";

  const sectionEnd = findSectionEnd(lines, sectionStart);
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const text = cleanImprovementLine(lines[i]);
    if (text) return text;
  }
  return "";
}

export async function saveDailyImprovement(
  filePath: string,
  text: string
): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((line) =>
    line.match(DAILY_IMPROVEMENT_HEADING_RE)
  );
  const sectionLines = ["", `- ${text.trim()}`];

  if (sectionStart === -1) {
    const needsBlank = lines.length > 0 && lines[lines.length - 1].trim() !== "";
    lines.push(
      ...(needsBlank ? [""] : []),
      "---",
      "",
      `## ${DAILY_IMPROVEMENT_HEADING}`,
      ...sectionLines
    );
  } else {
    const sectionEnd = findSectionEnd(lines, sectionStart);
    lines.splice(sectionStart + 1, sectionEnd - sectionStart - 1, ...sectionLines);
  }

  await fs.writeFile(filePath, lines.join("\n"));
}

export async function getDailyImprovementHistory(
  dirPath: string,
  date: string,
  days: number,
  shiftDate: (dateKey: string, days: number) => string
): Promise<DailyImprovementEntry[]> {
  const history: DailyImprovementEntry[] = [];
  for (let i = 0; i < days; i++) {
    const entryDate = shiftDate(date, -i);
    const filePath = `${dirPath}/${entryDate}.md`;
    try {
      history.push({
        date: entryDate,
        text: await parseDailyImprovement(filePath),
        exists: true,
      });
    } catch {
      history.push({ date: entryDate, text: "", exists: false });
    }
  }
  return history;
}

export function toggleTodoContent(
  content: string,
  lineIndex: number,
  checked: boolean,
  expectedText?: string
): string {
  const lines = content.split("\n");
  assertTargetTodoLine(lines, lineIndex, expectedText);

  // Toggle the target line
  lines[lineIndex] = toggleLine(lines[lineIndex], checked);

  // If checking a parent, auto-complete all descendants.
  if (checked) {
    const parentMatch = lines[lineIndex].match(TODO_LINE_RE);
    const parentDepth = parentMatch ? indentationDepth(parentMatch[1]) : 0;

    for (let i = lineIndex + 1; i < lines.length; i++) {
      const childMatch = lines[i].match(TODO_LINE_RE);
      if (!childMatch) {
        // Non-checkbox line — if blank or non-indented, stop
        if (!lines[i].match(/^[ \t]/) && lines[i].trim() !== "") break;
        continue;
      }
      const childDepth = indentationDepth(childMatch[1]);
      if (childDepth <= parentDepth) break;
      lines[i] = toggleLine(lines[i], true);
    }
  }

  updateParentTodoChecks(lines, lineIndex);

  return lines.join("\n");
}

export function addTodoContent(
  content: string,
  text: string
): string {
  const lines = content.split("\n");

  const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
  if (sectionStart === -1) {
    throw new Error("'오늘 할 일' 섹션을 찾을 수 없습니다.");
  }

  // Find the last checkbox line in the section
  let insertAt = sectionStart + 1;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) break;
    if (lines[i].match(TODO_LINE_RE)) {
      insertAt = i + 1;
    }
  }

  lines.splice(insertAt, 0, `- [ ] ${text}`);
  return lines.join("\n");
}

export function addChildTodoContent(
  content: string,
  parentLineIndex: number,
  text: string,
  expectedParentText?: string
): string {
  const lines = content.split("\n");
  assertTargetTodoLine(lines, parentLineIndex, expectedParentText);

  const parentMatch = lines[parentLineIndex].match(TODO_LINE_RE)!;
  const parentDepth = indentationDepth(parentMatch[1]);

  // Insert after the parent's last descendant so siblings stay in order
  let insertAt = parentLineIndex + 1;
  for (let i = parentLineIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(TODO_LINE_RE);
    if (!match) {
      if (!lines[i].match(/^[ \t]/) && lines[i].trim() !== "") break;
      continue;
    }
    if (indentationDepth(match[1]) <= parentDepth) break;
    insertAt = i + 1;
  }

  const indent = "\t".repeat(parentDepth + 1);
  lines.splice(insertAt, 0, `${indent}- [ ] ${text}`);

  // A new unchecked child must flip a checked parent back to unchecked
  updateParentTodoChecks(lines, insertAt);

  return lines.join("\n");
}

export interface TodoDraft {
  text: string;
  /** 연결 꼬리표 — 이월 초안이 보관했다가 새 날짜 줄에 재부착한다. */
  noteRef?: string;
  children?: TodoDraft[];
}

export function bulkAddTodosContent(
  content: string,
  drafts: TodoDraft[]
): string {
  const lines = content.split("\n");

  const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
  if (sectionStart === -1) {
    throw new Error("'오늘 할 일' 섹션을 찾을 수 없습니다.");
  }

  // Find insert position: after last checkbox line in section
  let insertAt = sectionStart + 1;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) break;
    if (lines[i].match(TODO_LINE_RE)) {
      insertAt = i + 1;
    }
  }

  // 같은 이름의 최상위 묶음(예: `[심플리몰]`)이 이미 있으면 새 부모를 만들지 않고 그 아래에 붙인다.
  const fresh: TodoDraft[] = [];
  for (const draft of drafts) {
    const parentLine = draft.children?.length
      ? findTopLevelTodoLine(lines, sectionStart, draft.text)
      : -1;
    if (parentLine === -1) {
      fresh.push(draft);
      continue;
    }
    const at = lastDescendantLine(lines, parentLine) + 1;
    lines.splice(at, 0, ...draft.children!.flatMap((child) => draftLines(child, 1)));
    lines[parentLine] = lines[parentLine].replace("- [x] ", "- [ ] ");
    insertAt = Math.max(insertAt, lastSectionTodoLine(lines, sectionStart) + 1);
  }

  lines.splice(insertAt, 0, ...fresh.flatMap((draft) => draftLines(draft, 0)));
  return lines.join("\n");
}

function draftLines(draft: TodoDraft, depth: number): string[] {
  const text = draft.noteRef ? attachNoteRef(draft.text, draft.noteRef) : draft.text;
  return [
    `${"\t".repeat(depth)}- [ ] ${text}`,
    ...(draft.children ?? []).flatMap((child) => draftLines(child, depth + 1)),
  ];
}

function findTopLevelTodoLine(lines: string[], sectionStart: number, text: string): number {
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) break;
    const match = lines[i].match(TODO_LINE_RE);
    if (match && match[1] === "" && match[3].trim() === text.trim()) return i;
  }
  return -1;
}

function lastDescendantLine(lines: string[], parentLine: number): number {
  let last = parentLine;
  for (let i = parentLine + 1; i < lines.length; i++) {
    const match = lines[i].match(TODO_LINE_RE);
    if (!match || match[1] === "") break;
    last = i;
  }
  return last;
}

function lastSectionTodoLine(lines: string[], sectionStart: number): number {
  let last = sectionStart;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) break;
    if (lines[i].match(TODO_LINE_RE)) last = i;
  }
  return last;
}

export interface HabitStats {
  completed: number;
  total: number;
}

export interface DayStats {
  date: string;
  completed: number;
  total: number;
}

export async function getWeeklyStats(
  dirPath: string,
  date: Date
): Promise<DayStats[]> {
  const stats: DayStats[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(date);
    d.setDate(d.getDate() - i);
    const dateStr = localDateKey(d);
    const filePath = `${dirPath}/${dateStr}.md`;

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
      if (sectionStart === -1) {
        stats.push({ date: dateStr, completed: 0, total: 0 });
        continue;
      }

      let completed = 0;
      let total = 0;
      for (let j = sectionStart + 1; j < lines.length; j++) {
        if (lines[j].match(/^##\s/)) break;
        const match = lines[j].match(TODO_LINE_RE);
        if (match && indentationDepth(match[1]) === 0) {
          total++;
          if (match[2] === "x") completed++;
        }
      }
      stats.push({ date: dateStr, completed, total });
    } catch {
      stats.push({ date: dateStr, completed: 0, total: 0 });
    }
  }

  return stats;
}

export function editTodoContent(
  content: string,
  lineIndex: number,
  newText: string,
  expectedText?: string
): string {
  const lines = content.split("\n");
  assertTargetTodoLine(lines, lineIndex, expectedText);

  const match = lines[lineIndex].match(/^([ \t]*- \[[ x]\] )/)!;
  // 연결 줄의 편집은 clean 텍스트로 들어온다 — 기존 꼬리표를 떼어 보관했다가 재부착.
  const existingRef = splitNoteRef(lines[lineIndex].slice(match[1].length)).ref;
  lines[lineIndex] =
    match[1] + (existingRef ? attachNoteRef(newText, existingRef) : newText);
  return lines.join("\n");
}

export function deleteTodoContent(
  content: string,
  lineIndex: number,
  expectedText?: string
): string {
  const lines = content.split("\n");
  assertTargetTodoLine(lines, lineIndex, expectedText);

  // Determine depth of the target line
  const match = lines[lineIndex].match(TODO_LINE_RE)!;
  const parentDepth = indentationDepth(match[1]);

  // Collect lines to remove: the target + all deeper children
  let endIndex = lineIndex + 1;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const childMatch = lines[i].match(TODO_LINE_RE);
    if (!childMatch) {
      if (!lines[i].match(/^[ \t]/) && lines[i].trim() !== "") break;
      continue;
    }
    if (indentationDepth(childMatch[1]) <= parentDepth) break;
    endIndex = i + 1;
  }

  lines.splice(lineIndex, endIndex - lineIndex);
  return lines.join("\n");
}

export function moveTopLevelTodoContent(
  content: string,
  lineIndex: number,
  direction: "up" | "down"
): string {
  const lines = content.split("\n");

  const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
  if (sectionStart === -1) throw new Error("'오늘 할 일' 섹션을 찾을 수 없습니다.");

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) {
      sectionEnd = i;
      break;
    }
  }

  // Collect top-level blocks: each entry is [startLine, endLineExclusive]
  const blocks: Array<[number, number]> = [];
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const m = lines[i].match(TODO_LINE_RE);
    if (!m || indentationDepth(m[1]) !== 0) continue;
    let end = i + 1;
    for (let j = i + 1; j < sectionEnd; j++) {
      const cm = lines[j].match(TODO_LINE_RE);
      if (cm && indentationDepth(cm[1]) === 0) break;
      if (!cm && !lines[j].match(/^[ \t]/) && lines[j].trim() !== "") break;
      end = j + 1;
    }
    blocks.push([i, end]);
    i = end - 1;
  }

  const idx = blocks.findIndex(([s, e]) => lineIndex >= s && lineIndex < e);
  if (idx === -1) throw new Error("해당 할일은 최상위 항목이 아닙니다.");

  const target = blocks[idx];
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= blocks.length) return content;
  const other = blocks[swapIdx];

  const targetLines = lines.slice(target[0], target[1]);
  const otherLines = lines.slice(other[0], other[1]);

  if (direction === "up") {
    lines.splice(other[0], target[1] - other[0], ...targetLines, ...otherLines);
  } else {
    lines.splice(target[0], other[1] - target[0], ...otherLines, ...targetLines);
  }

  return lines.join("\n");
}

export function reorderTopLevelTodoContent(
  content: string,
  fromLineIndex: number,
  targetLineIndex: number,
  position: "above" | "below",
  expected?: { fromText: string; targetText: string }
): string {
  const lines = content.split("\n");
  if (expected) {
    assertTargetTodoLine(lines, fromLineIndex, expected.fromText);
    assertTargetTodoLine(lines, targetLineIndex, expected.targetText);
  }

  const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
  if (sectionStart === -1) throw new Error("'오늘 할 일' 섹션을 찾을 수 없습니다.");

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) {
      sectionEnd = i;
      break;
    }
  }

  const blocks: Array<[number, number]> = [];
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const m = lines[i].match(TODO_LINE_RE);
    if (!m || indentationDepth(m[1]) !== 0) continue;
    let end = i + 1;
    for (let j = i + 1; j < sectionEnd; j++) {
      const cm = lines[j].match(TODO_LINE_RE);
      if (cm && indentationDepth(cm[1]) === 0) break;
      if (!cm && !lines[j].match(/^[ \t]/) && lines[j].trim() !== "") break;
      end = j + 1;
    }
    blocks.push([i, end]);
    i = end - 1;
  }

  const fromIdx = blocks.findIndex(([s, e]) => fromLineIndex >= s && fromLineIndex < e);
  const targetIdx = blocks.findIndex(([s, e]) => targetLineIndex >= s && targetLineIndex < e);
  if (fromIdx === -1 || targetIdx === -1) {
    throw new Error("해당 할일은 최상위 항목이 아닙니다.");
  }

  const dropIdx = position === "below" ? targetIdx + 1 : targetIdx;
  if (dropIdx === fromIdx || dropIdx === fromIdx + 1) return content;

  const blockContents = blocks.map(([s, e]) => lines.slice(s, e));
  const [moved] = blockContents.splice(fromIdx, 1);
  const adjustedDrop = dropIdx > fromIdx ? dropIdx - 1 : dropIdx;
  blockContents.splice(adjustedDrop, 0, moved);

  const firstStart = blocks[0][0];
  const lastEnd = blocks[blocks.length - 1][1];
  lines.splice(firstStart, lastEnd - firstStart, ...blockContents.flat());

  return lines.join("\n");
}

function toggleLine(line: string, checked: boolean): string {
  if (checked) {
    return line.replace("- [ ] ", "- [x] ");
  } else {
    return line.replace("- [x] ", "- [ ] ");
  }
}

function assertTargetTodoLine(
  lines: string[],
  lineIndex: number,
  expectedText?: string
): void {
  const line = lines[lineIndex];
  const match = line?.match(TODO_LINE_RE);
  if (!match) throw new Error("해당 줄은 할일이 아닙니다.");
  // 링크 꼬리표(^clb…)는 화면에서 숨겨지므로 클라이언트의 expectedText는 항상
  // clean 텍스트다. 꼬리표를 벗기고 비교하지 않으면 연결된 줄의 모든 토글·수정이
  // 여기서 죽는다 (plans/collab-todo-link.md의 최다 빈발 함정).
  if (expectedText !== undefined && !sameTodoText(match[3], expectedText)) {
    throw new Error("할일 파일이 변경되었습니다. 새로고침 후 다시 시도해주세요.");
  }
}

function updateParentTodoChecks(lines: string[], changedLineIndex: number) {
  const targetMatch = lines[changedLineIndex]?.match(TODO_LINE_RE);
  if (!targetMatch) return;

  let currentDepth = indentationDepth(targetMatch[1]);
  if (currentDepth === 0) return;

  for (let i = changedLineIndex - 1; i >= 0 && currentDepth > 0; i--) {
    const parentMatch = lines[i].match(TODO_LINE_RE);
    if (!parentMatch) {
      if (!lines[i].match(/^[ \t]/) && lines[i].trim() !== "") break;
      continue;
    }

    const parentDepth = indentationDepth(parentMatch[1]);
    if (parentDepth >= currentDepth) continue;

    const children = getImmediateChildTodoLines(lines, i, parentDepth);
    if (children.length > 0) {
      const allChildrenChecked = children.every(
        (childIndex) => lines[childIndex].match(TODO_LINE_RE)?.[2] === "x"
      );
      lines[i] = toggleLine(lines[i], allChildrenChecked);
    }

    currentDepth = parentDepth;
  }
}

/* ---- 협업 링크 꼬리표(ref) 주소 지정 헬퍼 (plans/collab-todo-link.md) ---- */

export interface NoteRefState {
  ref: string;
  checked: boolean;
  /** Clean display text (token stripped). */
  text: string;
  lineIndex: number;
}

/** 파일 안의 모든 연결 줄 상태. 파일이 없으면 null (읽기 실패와 구분). */
export async function readNoteRefStates(filePath: string): Promise<NoteRefState[] | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  const states: NoteRefState[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(TODO_LINE_RE);
    if (!match) continue;
    const { clean, ref } = splitNoteRef(match[3]);
    if (!ref) continue;
    states.push({ ref, checked: match[2] === "x", text: clean, lineIndex: i });
  }
  return states;
}

function findRefLineIndex(lines: string[], ref: string): number {
  return lines.findIndex((line) => {
    const match = line.match(TODO_LINE_RE);
    return match != null && splitNoteRef(match[3]).ref === ref;
  });
}

/** 보드→노트 완료 동기화. 줄을 찾아 체크를 맞추면 true. */
export async function setTodoCheckedByRef(
  filePath: string,
  ref: string,
  checked: boolean
): Promise<boolean> {
  const content = await fs.readFile(filePath, "utf-8").catch(() => null);
  if (content === null) return false;
  const lines = content.split("\n");
  const idx = findRefLineIndex(lines, ref);
  if (idx === -1) return false;
  const already = lines[idx].match(TODO_LINE_RE)![2] === "x";
  if (already === checked) return true;
  await toggleTodo(filePath, idx, checked);
  return true;
}

/** 보드→노트 제목 동기화. 꼬리표는 유지한 채 본문만 바꾼다. */
export async function setTodoTextByRef(
  filePath: string,
  ref: string,
  cleanText: string
): Promise<boolean> {
  const content = await fs.readFile(filePath, "utf-8").catch(() => null);
  if (content === null) return false;
  const lines = content.split("\n");
  const idx = findRefLineIndex(lines, ref);
  if (idx === -1) return false;
  const prefix = lines[idx].match(/^([ \t]*- \[[ x]\] )/)![1];
  lines[idx] = prefix + attachNoteRef(cleanText, ref);
  await fs.writeFile(filePath, lines.join("\n"));
  return true;
}

/** 줄에 꼬리표를 심거나(연결) 떼어낸다(해제). */
export async function setTodoNoteRef(
  filePath: string,
  lineIndex: number,
  ref: string | null,
  expectedText?: string
): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  assertTargetTodoLine(lines, lineIndex, expectedText);
  const match = lines[lineIndex].match(/^([ \t]*- \[[ x]\] )(.*)$/)!;
  const { clean } = splitNoteRef(match[2]);
  lines[lineIndex] = match[1] + (ref ? attachNoteRef(clean, ref) : clean);
  await fs.writeFile(filePath, lines.join("\n"));
}

/**
 * 부탁 수락(F3) → 오늘 노트에 연결 줄 + 세부 단계 자식 줄을 한 번에 추가.
 * 자식 줄엔 꼬리표를 심지 않는다 (v1: 최상위 줄만 동기화).
 */
export async function appendLinkedTodo(
  filePath: string,
  cleanTitle: string,
  ref: string,
  childTexts: string[] = []
): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");

  const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
  if (sectionStart === -1) {
    throw new Error("'오늘 할 일' 섹션을 찾을 수 없습니다.");
  }
  let insertAt = sectionStart + 1;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) break;
    if (lines[i].match(TODO_LINE_RE)) insertAt = i + 1;
  }
  const newLines = [
    `- [ ] ${attachNoteRef(cleanTitle, ref)}`,
    ...childTexts.map((t) => `\t- [ ] ${t}`),
  ];
  lines.splice(insertAt, 0, ...newLines);
  await fs.writeFile(filePath, lines.join("\n"));
}

function getImmediateChildTodoLines(
  lines: string[],
  parentLineIndex: number,
  parentDepth: number
): number[] {
  const childLineIndexes: number[] = [];

  for (let i = parentLineIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(TODO_LINE_RE);
    if (!match) {
      if (!lines[i].match(/^[ \t]/) && lines[i].trim() !== "") break;
      continue;
    }

    const depth = indentationDepth(match[1]);
    if (depth <= parentDepth) break;
    if (depth === parentDepth + 1) childLineIndexes.push(i);
  }

  return childLineIndexes;
}

/* ---- 파일 버전: 위 *Content 변환을 Obsidian 노트 파일에 적용한다 ---- */

async function editNoteFile(filePath: string, edit: (content: string) => string): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  await fs.writeFile(filePath, edit(content));
}

export async function toggleTodo(
  filePath: string,
  lineIndex: number,
  checked: boolean,
  expectedText?: string
): Promise<void> {
  await editNoteFile(filePath, (content) => toggleTodoContent(content, lineIndex, checked, expectedText));
}

export async function addTodo(
  filePath: string,
  text: string
): Promise<void> {
  await editNoteFile(filePath, (content) => addTodoContent(content, text));
}

export async function addChildTodo(
  filePath: string,
  parentLineIndex: number,
  text: string,
  expectedParentText?: string
): Promise<void> {
  await editNoteFile(filePath, (content) => addChildTodoContent(content, parentLineIndex, text, expectedParentText));
}

export async function bulkAddTodos(
  filePath: string,
  drafts: TodoDraft[]
): Promise<void> {
  await editNoteFile(filePath, (content) => bulkAddTodosContent(content, drafts));
}

export async function editTodo(
  filePath: string,
  lineIndex: number,
  newText: string,
  expectedText?: string
): Promise<void> {
  await editNoteFile(filePath, (content) => editTodoContent(content, lineIndex, newText, expectedText));
}

export async function deleteTodo(
  filePath: string,
  lineIndex: number,
  expectedText?: string
): Promise<void> {
  await editNoteFile(filePath, (content) => deleteTodoContent(content, lineIndex, expectedText));
}

export async function moveTopLevelTodo(
  filePath: string,
  lineIndex: number,
  direction: "up" | "down"
): Promise<void> {
  await editNoteFile(filePath, (content) => moveTopLevelTodoContent(content, lineIndex, direction));
}

export async function reorderTopLevelTodo(
  filePath: string,
  fromLineIndex: number,
  targetLineIndex: number,
  position: "above" | "below"
): Promise<void> {
  await editNoteFile(filePath, (content) => reorderTopLevelTodoContent(content, fromLineIndex, targetLineIndex, position));
}

/**
 * 같은 묶음(예: `[심플리몰]`)의 할 일을 한 부모 줄 아래로 모은다.
 * 오늘 할 일 섹션의 최상위 줄 중 글자가 groupText와 같은 줄을 부모로 쓰고,
 * 없으면 부모 줄을 새로 만든다.
 */
export function addTodoUnderGroupContent(
  content: string,
  groupText: string,
  text: string
): string {
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((line) => line.match(TODO_HEADING_RE));
  let parentLineIndex = -1;
  for (let i = sectionStart + 1; sectionStart !== -1 && i < lines.length; i++) {
    if (lines[i].match(/^##\s/)) break;
    const match = lines[i].match(TODO_LINE_RE);
    if (match && match[1] === "" && match[3].trim() === groupText) {
      parentLineIndex = i;
      break;
    }
  }
  if (parentLineIndex !== -1) {
    return addChildTodoContent(content, parentLineIndex, text);
  }
  const withGroup = addTodoContent(content, groupText);
  const groupLine = withGroup
    .split("\n")
    .findLastIndex((line) => line === `- [ ] ${groupText}`);
  return addChildTodoContent(withGroup, groupLine, text);
}
