import { toActionItems } from "./analysis";
import type { ActionItem, MeetingAnalysis, MeetingTranscript, TranscriptSegment } from "./types";

// 10-16 henry: 103분 회의를 한 번에 분석하면 세부 할 일이 빠진다("디테일이 떨어져").
// 전사를 15분 구간(앞뒤 1분 겹침)으로 나눠 할 일만 따로 뽑고, 겹친 것은 합친다.
const CHUNK_SEC = 15 * 60;
const OVERLAP_SEC = 60;
const CONCURRENCY = 3;
/** 같은 일로 볼 유사도(글자 두 개 묶음 기준). */
const SAME_TASK = 0.5;
export const TASK_CHUNK_TIMEOUT_MS = 6 * 60 * 1000;

export interface TranscriptChunk {
  readonly startSec: number;
  readonly text: string;
}

function clock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${m}:${r}` : `${m}:${r}`;
}

export function chunkTranscript(segments: readonly TranscriptSegment[]): TranscriptChunk[] {
  const end = segments.at(-1)?.t ?? 0;
  const chunks: TranscriptChunk[] = [];
  for (let start = 0; start <= end; start += CHUNK_SEC) {
    const lines = segments
      .filter((s) => (s.t ?? 0) >= start - OVERLAP_SEC && (s.t ?? 0) < start + CHUNK_SEC + OVERLAP_SEC)
      .map((s) => `[${clock(s.t ?? 0)}] ${s.text}`);
    if (lines.length) chunks.push({ startSec: start, text: lines.join("\n") });
  }
  return chunks;
}

export function buildTaskPrompt(chunk: TranscriptChunk, analysis: MeetingAnalysis): string {
  const people = (analysis.roles ?? []).map((r) => `${r.name}: ${r.role}`).join("\n");
  const goals = [...new Set((analysis.actionItems ?? []).map((t) => t.goal).filter(Boolean))].join(", ");
  return `아래는 회의 전사 중 ${clock(chunk.startSec)}부터의 15분 구간입니다. 이 구간에서 **회의 뒤에 누군가 실제로 해야 하는 일**을 빠짐없이 뽑으세요.

회의 목적: ${analysis.purpose ?? analysis.summary}
참석자와 역할(이 이름 표기를 그대로 쓰세요):
${people || "(없음)"}
이미 정한 상위 목표(맞으면 같은 글자로 goal 에 쓰세요): ${goals || "(없음)"}

규칙:
- 꼼꼼하게 뽑으세요. "누가 ~할게요", "~해 주세요", "~까지 해야 돼요", "~하기로 했죠" 같은 발언은 모두 할 일 후보입니다. 숫자·개수·대상 이름(브랜드·문서·화면·사람)을 task 에 넣으세요.
- task 는 "SKU 7개 상품 이미지 AI로 생성하기"처럼 결과물이 드러나는 "~하기" 꼴입니다. "확인하기"처럼 대상이 없는 말은 쓰지 마세요.
- 한 일 안에 순서가 있는 작업이 말해졌으면 steps 에 2~5개로 적으세요(예: "상품 설명", "심플리몰 노트", "선택 이유 3가지", "온라인 리뷰 3가지"). 말해지지 않은 단계는 지어내지 마세요.
- owner 는 발언에서 맡은 사람이 드러날 때만 이름으로, 아니면 "미정"입니다. 화자 표시는 없습니다.
  · 회의를 이끄는 진행자가 다른 사람에게 일을 나눠 주다가 "제가 기획할게요", "제가 얘기해 놓을게요"라고 하면 진행자 본인의 일입니다. 그 사람에게 넘기지 마세요. 진행자 이름을 모르면 owner 를 "진행자"로 적으세요.
  · "~님이 해 주세요" 다음의 "네, 제가 할게요"는 방금 불린 사람의 일입니다.
  · 함께 하자는 사람만 적고, 발언에 없는 참석자를 덧붙이지 마세요.
- due 는 "오늘", "내일", "월요일", "일요일 밤"처럼 짧게. 조건형 기한은 caution 에 쓰세요.
- why(목적)·inputs(재료·대상)·how(방법)·doneWhen(완료 기준)·caution(주의·바뀐 사정)은 전사에 근거가 있을 때만 1~2문장으로 적으세요.
- quote 는 그 일이 나온 전사 문장을 글자 그대로 15~40자 복사합니다. 시각 표시([mm:ss])는 빼세요.
- 같은 결과물을 위한 일이 2개 이상이면 같은 goal 을 쓰세요.
- 조언·아이디어만 나오고 아무도 맡지 않은 것, "다들 열심히 하자" 같은 전체 다짐은 빼세요.
- 같은 일을 표현만 바꿔 두 번 적지 마세요. 다른 일의 단계에 해당하면 그 일의 steps 로 넣으세요.
- 구간 끝에서 기한이나 담당이 바뀌면 바뀐 값을 쓰고, 처음 값은 caution 에 적으세요.

JSON 만 출력하세요:
{"actionItems": [{"owner": "", "task": "", "due": "", "goal": "", "why": "", "inputs": "", "how": "", "doneWhen": "", "caution": "", "steps": [""], "quote": ""}]}

--- 전사 ---
${chunk.text}
--- 끝 ---`;
}

function parseTasks(raw: string): ActionItem[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { actionItems?: unknown };
    return toActionItems(obj.actionItems);
  } catch {
    return [];
  }
}

function grams(text: string): Set<string> {
  const c = text.replace(/[^\p{L}\p{N}]/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < c.length - 1; i += 1) out.add(c.slice(i, i + 2));
  return out;
}

function similar(a: ActionItem, b: ActionItem): number {
  const ga = grams(a.task);
  const gb = grams(b.task);
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit += 1;
  const byTask = hit / Math.max(1, Math.min(ga.size, gb.size));
  const sameQuote = Boolean(a.quote && b.quote && (a.quote.includes(b.quote) || b.quote.includes(a.quote)));
  return sameQuote ? 1 : byTask;
}

function richness(t: ActionItem): number {
  return [t.why, t.inputs, t.how, t.doneWhen, t.caution, t.due].filter(Boolean).length + (t.steps?.length ?? 0);
}

/** 겹친 구간에서 두 번 뽑힌 일을 합친다. 더 자세한 쪽을 남기고, 빈 담당·목표는 채운다. */
export function mergeTasks(tasks: readonly ActionItem[]): ActionItem[] {
  const out: ActionItem[] = [];
  for (const task of tasks) {
    const at = out.findIndex((kept) => similar(kept, task) >= SAME_TASK);
    if (at < 0) {
      out.push(task);
      continue;
    }
    const kept = out[at];
    const [rich, poor] = richness(task) > richness(kept) ? [task, kept] : [kept, task];
    out[at] = {
      ...poor,
      ...rich,
      owner: rich.owner === "미정" ? poor.owner : rich.owner,
      ...((rich.goal ?? poor.goal) && { goal: rich.goal ?? poor.goal }),
    };
  }
  return out;
}

async function inBatches<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  }
  return out;
}

/**
 * 구간별로 할 일을 다시 뽑아 전체 분석의 할 일을 바꾼다.
 * 한 구간이 실패해도 나머지로 진행하고, 전부 실패하면 원래 할 일을 그대로 둔다.
 */
export async function refineTasks(
  analysis: MeetingAnalysis,
  transcript: MeetingTranscript,
  extract: (prompt: string) => Promise<string>
): Promise<MeetingAnalysis> {
  const chunks = chunkTranscript(transcript.segments);
  if (chunks.length === 0) return analysis;
  const results = await inBatches(chunks, CONCURRENCY, async (chunk) => {
    try {
      return parseTasks(await extract(buildTaskPrompt(chunk, analysis)));
    } catch (e) {
      console.warn("[meetings] 구간 할 일 뽑기 실패:", clock(chunk.startSec), e instanceof Error ? e.message : e);
      return [];
    }
  });
  const merged = mergeTasks(results.flat());
  if (!merged.length) return analysis;
  const names = (analysis.roles ?? []).map((r) => r.name);
  const verified = await verifyTasks(merged, transcript.segments, extract, names);
  return { ...analysis, actionItems: verified };
}

// 10-16 henry: "어떻게 하는지 알려줄 거예요"를 바로 앞의 SKU 업로드로 잘못 이은 사고.
// 뽑은 뒤 할 일마다 원문 앞뒤 문장을 다시 보여 주고, 지시어가 가리키는 대상을 확인해 고친다.
const VERIFY_BATCH = 12;
const CONTEXT_BEFORE = 5;
const CONTEXT_AFTER = 3;

const compact = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "");

/** quote 가 든 발언의 앞뒤 문장. 못 찾으면 빈 문자열. */
export function quoteContext(segments: readonly TranscriptSegment[], quote?: string): string {
  if (!quote) return "";
  const needle = compact(quote).slice(0, 20);
  const at = segments.findIndex((s) => compact(s.text).includes(needle));
  if (at < 0) return "";
  return segments
    .slice(Math.max(0, at - CONTEXT_BEFORE), at + CONTEXT_AFTER + 1)
    .map((s, i, all) => `${segments.indexOf(all[i]) === at ? ">> " : ""}[${clock(s.t ?? 0)}] ${s.text}`)
    .join("\n");
}

export function buildVerifyPrompt(
  items: ReadonlyArray<{ id: number; task: ActionItem; context: string }>,
  names: readonly string[] = []
): string {
  const body = items
    .map(({ id, task, context }) => `### ${id}\n할 일: ${task.task} (담당: ${task.owner})\n원문(>> 가 근거 문장):\n${context}`)
    .join("\n\n");
  return `회의록에서 뽑은 할 일이 원문과 맞는지 검사하세요. 각 할 일마다 원문 앞뒤를 읽고 판단합니다.

검사할 것:
- 근거 문장의 "이거", "그거", "어떻게 하는지", "그 세션" 같은 지시어는 **바로 앞 1~2문장**에서 하던 행동을 가리킵니다. 그보다 앞에서 나온 다른 주제(예: 몇 문장 전에 끝난 다른 업무)를 할 일 이름에 넣었으면, 바로 앞 문장의 행동으로 고치세요.
- 할 일 이름의 핵심 명사(무엇을 하는지)가 근거 문장이나 바로 앞 2문장에 없으면 fix 대상입니다.
- 담당자가 원문과 다르면 고치세요. 화자 표시는 없으니 호칭과 흐름으로 판단합니다. owner 는 반드시 다음 이름 중 하나를 글자 그대로 쓰세요: ${[...names, "미정"].join(", ")}. 확신이 없으면 owner 를 비워 두세요(원래 담당 유지).
- 원문에 없는 숫자·대상·참석자를 덧붙였으면 빼세요.
- 지시어가 가리키는 대상이 앞뒤 문장만으로 확실하지 않거나, 할 일인지 조언·과거 설명인지 애매하면 unsure 로 두세요. 지우지 않고 사람에게 확인을 받습니다.

verdict 는 keep, fix, unsure 중 하나입니다. fix 면 task(결과물이 드러나는 "~하기" 꼴)와 owner 를 고친 값으로 적으세요. fix 와 unsure 는 reason 에 이유를 1문장으로 적으세요(unsure 면 무엇이 애매한지).

JSON 만 출력하세요:
{"results": [{"id": 0, "verdict": "keep", "task": "", "owner": "", "reason": ""}]}

${body}`;
}

interface Verdict {
  readonly id: number;
  readonly verdict: "keep" | "fix" | "unsure" | "drop";
  readonly task?: string;
  readonly owner?: string;
  readonly reason?: string;
}

function parseVerdicts(raw: string): Verdict[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return [];
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { results?: unknown };
    return Array.isArray(obj.results) ? (obj.results as Verdict[]) : [];
  } catch {
    return [];
  }
}

const UNSURE_DEFAULT = "원문만으로는 대상이 분명하지 않습니다.";

function fixedFields(verdict: Verdict, names: ReadonlySet<string>): Partial<ActionItem> {
  const task = verdict.task?.trim();
  const owner = verdict.owner?.trim();
  // 명단 밖 이름("상근", "화자")이나 "미정"으로 되돌리는 건 받지 않는다. 담당은 아는 사람일 때만 바꾼다.
  return { ...(task && { task }), ...(owner && names.has(owner) && { owner }) };
}

function applyVerdict(task: ActionItem, names: ReadonlySet<string>, verdict?: Verdict): ActionItem {
  if (!verdict || verdict.verdict === "keep") return task;
  // 지우면 맞는 할 일까지 사라진다(10-16 실측 2건). 애매하면 표시만 하고 사람이 정한다.
  if (verdict.verdict === "fix") return { ...task, ...fixedFields(verdict, names) };
  return { ...task, unsure: verdict.reason?.trim() || UNSURE_DEFAULT };
}

/** 원문 앞뒤로 할 일을 검사해 고치거나 "확인 필요"를 붙인다. 검사 호출이 실패한 묶음은 그대로 둔다. */
export async function verifyTasks(
  tasks: readonly ActionItem[],
  segments: readonly TranscriptSegment[],
  extract: (prompt: string) => Promise<string>,
  knownNames: readonly string[] = []
): Promise<ActionItem[]> {
  const names = new Set([...knownNames, ...tasks.map((t) => t.owner)].filter((n) => n && n !== "미정"));
  const items = tasks
    .map((task, id) => ({ id, task, context: quoteContext(segments, task.quote) }))
    .filter((item) => item.context);
  const batches: Array<typeof items> = [];
  for (let i = 0; i < items.length; i += VERIFY_BATCH) batches.push(items.slice(i, i + VERIFY_BATCH));
  const verdicts = new Map<number, Verdict>();
  await inBatches(batches, CONCURRENCY, async (batch) => {
    try {
      for (const v of parseVerdicts(await extract(buildVerifyPrompt(batch, [...names])))) verdicts.set(v.id, v);
    } catch (e) {
      console.warn("[meetings] 할 일 검사 실패:", e instanceof Error ? e.message : e);
    }
  });
  return tasks.map((task, id) => applyVerdict(task, names, verdicts.get(id)));
}
