import { getOwnerName } from "../settings";
import { generateText } from "../ai/generate";
import { parseJsonObject } from "../ai/json";
import type { TodoDraft } from "../obsidian-parser";
import { meetingLinkSuffix, meetingTodoTag } from "./action-todo";
import { buildTranscriptPlain } from "./transcript";
import type { Meeting } from "./types";

type Generate = (prompt: string) => Promise<string>;

const MAX_TRANSCRIPT_CHARS = 60_000;
const MAX_TODOS = 20;

function actionLines(meeting: Meeting): string {
  const actions = meeting.analysis?.actionItems ?? [];
  return actions.map((a) => `- ${a.owner}: ${a.task}`).join("\n") || "(없음)";
}

function transcriptText(meeting: Meeting): string {
  const plain = buildTranscriptPlain(meeting.transcript?.segments ?? []);
  return plain.slice(0, MAX_TRANSCRIPT_CHARS) || "(전사 없음)";
}

// 회의 분석의 actionItems는 회의 전체의 일을 요약해서, 화자 구분이 없는 전사에서는
// 녹음한 본인 몫이 "미정"이나 다른 사람 몫에 묻힌다. 그래서 전사를 다시 읽혀
// 본인이 직접 해야 하는 일만 따로 뽑는다.
export function buildMyTodosPrompt(meeting: Meeting): string {
  const owner = getOwnerName();
  return `아래 회의에서 ${owner}님이 직접 해야 하는 일만 골라 할 일 목록으로 만드세요.

${owner}님은 전사에서 "${owner}", "${owner}님", "제가/저는"(본인이 말할 때)으로 나옵니다.
전사에는 화자 표시가 없으니 문맥으로 누가 맡았는지 판단하세요.

규칙:
- ${owner}님이 맡거나, 요청받거나, 하겠다고 말한 일만 넣습니다. 다른 사람 몫은 넣지 않습니다.
- 한 항목은 바로 체크할 수 있는 행동 하나입니다. 동사로 끝냅니다. 두 행동을 "및"·"/"로 잇지 않습니다.
- 회의에 나온 사람 이름·서비스 이름·기한을 살립니다. 기한이 있으면 문장 끝 괄호로 붙입니다.
- 회의에 없는 일을 지어내지 않습니다. 없으면 빈 배열을 돌려줍니다.
- 같은 결과물을 향한 같은 행동은 하나로 합칩니다. 더 구체적인 문장과 더 이른 기한을 남깁니다.
- 결과물이 다르면 합치지 않습니다. 예: 상품 설명·노트·체크포인트는 세 할 일로 나눕니다.

디테일 규칙(가장 중요):
- 할 일 문장만 읽고 회의록을 다시 열지 않아도 바로 일할 수 있어야 합니다.
- 회의에 나온 아래 정보를 빠짐없이 문장에 넣습니다. 짧게 줄이지 않습니다.
  · 대상과 개수: 무엇을 몇 개 (예: 상품 260개마다 체크포인트 3개)
  · 재료·출처·장소: 무엇을 보고, 어디서 (예: 브랜드 공식 상세페이지와 온라인 정보, 자사몰·네이버 스마트스토어)
  · 기준·조건: 어떻게 되어야 끝인지 (예: 기존 촬영 사진 톤앤매너에 맞추고 상품 형태는 바꾸지 않기)
  · 방식·형식: 회의에서 정한 방법 (예: 짧은 문장, 팩트 기반, 캡처)
  · 이름: '심플리몰이 선택한 이유'처럼 회의에서 쓴 이름은 따옴표 그대로
- 각 할 일은 "분석이 뽑은 할 일"의 같은 항목보다 정보가 적으면 안 됩니다. 전사에서 더 찾을 수 있으면 더 넣습니다.

문장 규칙(ASD-STE100 기반):
- do: 지금 할 행동 하나. 25자 이내. "무엇을 + 동사하기" 형태. 예: "상품 260개 설명 생성하기".
- do에는 조건·이유·기한을 넣지 않습니다. 기한은 due에, 조건은 detail에 둡니다.
- detail은 회의록을 열지 않고 바로 일할 수 있게 아래 칸을 채웁니다. 회의에 근거가 없는 칸은 빈 문자열로 둡니다.
  · why: 이 일을 왜 하는지, 결과가 어디에 쓰이는지 (예: 금요일 1차 공개 상세페이지 '선택한 이유' 칸에 들어갑니다.)
  · input: 무엇을 보고, 어디서 가져오는지. 출처·파일·사이트·사람 이름 (예: 브랜드 공식 상세페이지의 키 셀링 포인트)
  · how: 회의에서 정한 방법·형식·말투·개수 (예: 한마디 문장 3개, '예뻐서 숨길 필요가 없어요'처럼)
  · done: 끝났다고 볼 기준 (예: 260개 상품 모두 3개씩 채워짐)
  · watch: 회의에서 나온 주의점·하지 말 것·누구와 확인할지 (예: 상품 형태는 바꾸지 않습니다.)
  · 각 칸은 1~2문장, 한 문장 50자 이내, "~합니다" 능동태. 같은 정보를 두 칸에 반복하지 않습니다.
- due: 회의에서 말한 기한 그대로(예: "금요일 밤", "12월 초 전"). 없으면 빈 문자열.
- 수동태("~될 수 있습니다"), "및"으로 두 행동 잇기, 흐린 말("적절히", "등")을 쓰지 않습니다.
- 묶음 이름은 끝난 결과로 20자 이내.
- 최대 ${MAX_TODOS}개.

묶기 규칙:
- 같은 결과물(예: 상세페이지 260개, 1차 공개)을 함께 만드는 할 일 2개 이상은 한 묶음으로 둡니다.
- 묶음 이름은 끝났을 때의 결과로 씁니다. 예: "상품 260개 상세페이지 문구 완성". "기타"·"긴급"·"작업" 같은 이름은 쓰지 않습니다.
- 묶음 안 할 일을 모두 끝내면 묶음 이름의 결과가 나와야 합니다. 할 일 하나는 한 묶음에만 넣습니다.
- 다른 할 일과 결과물을 공유하지 않는 할 일은 할 일 1개짜리 묶음으로 두고 title을 비웁니다.

출력은 JSON 하나: {"groups":[{"title":"결과형 묶음 이름 또는 빈 문자열","tasks":[{"do":"...","due":"...","detail":{"why":"","input":"","how":"","done":"","watch":""}}]}]}

회의 제목: ${meeting.title ?? meeting.analysis?.headline ?? meeting.date}
회의 요약: ${meeting.analysis?.summary ?? "(없음)"}

분석이 뽑은 할 일(담당자: 할 일):
${actionLines(meeting)}

전사:
${transcriptText(meeting)}`;
}

type TaskGroup = { title: string; tasks: string[] };

const cleanText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// 화면(todo-text-parts.ts)은 "라벨: 내용" 조각을 라벨별 줄로 보여 준다.
const DETAIL_LABELS = [
  ["why", "목적"],
  ["input", "재료"],
  ["how", "방법"],
  ["done", "완료 기준"],
  ["watch", "주의"],
] as const;

function detailParts(detail: unknown): string[] {
  if (typeof detail === "string") return detail.trim() ? [detail.trim()] : [];
  if (!detail || typeof detail !== "object") return [];
  const fields = detail as Record<string, unknown>;
  return DETAIL_LABELS.flatMap(([key, label]) => {
    const text = cleanText(fields[key]);
    return text ? [`${label}: ${text}`] : [];
  });
}

/** {do, due, detail}을 `행동 (기한) · 세부` 한 줄로. 화면은 splitTodoText로 다시 나눈다. */
function taskText(task: unknown): string {
  if (typeof task === "string") return task.trim();
  if (!task || typeof task !== "object") return "";
  const { do: action, due, detail } = task as Record<string, unknown>;
  const head = cleanText(action);
  if (!head) return "";
  const when = cleanText(due);
  const more = detailParts(detail).map((part) => ` · ${part.replace(/ · /g, ", ")}`).join("");
  return `${head}${when ? ` (${when})` : ""}${more}`;
}

/** 모델의 묶음을 읽고, 빈 할 일·여러 묶음에 겹친 할 일을 걸러 최대 개수로 자른다. */
function parseGroups(raw: string): TaskGroup[] {
  const data = parseJsonObject<{ groups?: { title?: unknown; tasks?: unknown }[] }>(raw);
  const seen = new Set<string>();
  let budget = MAX_TODOS;
  const groups: TaskGroup[] = [];
  for (const group of data.groups ?? []) {
    const tasks = (Array.isArray(group.tasks) ? group.tasks : [])
      .map(taskText)
      .filter((task) => task && !seen.has(task))
      .slice(0, budget);
    tasks.forEach((task) => seen.add(task));
    budget -= tasks.length;
    if (tasks.length > 0) groups.push({ title: cleanText(group.title), tasks });
  }
  return groups;
}

/** 이름 있는 2개 이상 묶음만 부모 줄을 만든다. 나머지는 할 일마다 한 줄. */
function groupToDrafts(group: TaskGroup, link: string): TodoDraft[] {
  if (group.title && group.tasks.length > 1) {
    return [{ text: `${group.title}${link}`, children: group.tasks.map((text) => ({ text })) }];
  }
  return group.tasks.map((task) => ({ text: `${task}${link}` }));
}

const defaultGenerate: Generate = (prompt) =>
  generateText({ tier: "reasoning", prompt, json: true, timeoutMs: 240_000 });

export async function extractMyTodos(
  meeting: Meeting,
  generate: Generate = defaultGenerate
): Promise<TodoDraft[]> {
  const groups = parseGroups(await generate(buildMyTodosPrompt(meeting)));
  const link = meetingLinkSuffix(meeting);
  const drafts = groups.flatMap((group) => groupToDrafts(group, link));
  // 3단계: [태그] 프로젝트 → 결과 묶음 → 할 일
  const tag = meetingTodoTag(meeting);
  if (!tag || drafts.length === 0) return drafts;
  return [{ text: `[${tag}]`, children: drafts }];
}
