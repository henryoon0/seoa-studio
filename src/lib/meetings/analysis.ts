import { normalizeMeetingTag } from "./tags";
import type {
  ActionItem,
  AutomationLead,
  FlowStage,
  GlossaryTerm,
  MeetingAnalysis,
  PersonRole,
  ScheduleItem,
  TopicSection,
} from "./types";

/** 코드펜스(```json …```)를 벗겨낸다. */
function stripCodeFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  return t.trim();
}

/** 펜스 우선 → 첫 `{` ~ 마지막 `}` 추출. 실패 시 null. */
function extractObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripCodeFence(raw);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0);
}

function normalizeOwner(owner: unknown): ActionItem["owner"] {
  const raw = typeof owner === "string" ? owner.trim() : "";
  const lower = raw.toLowerCase();
  if (["me", "i", "나", "본인"].includes(lower)) return "나";
  if (["them", "counterpart", "상대", "the other", "other"].includes(lower)) {
    return "상대";
  }
  // 화자 구분이 불확실하거나 공동 작업이면 "함께"로 정규화 — 잘못된 담당자
  // 지정(화자 라벨 오류의 2차 피해)보다 안전하다.
  if (
    ["both", "we", "us", "together", "함께", "우리", "둘 다", "나와 상대", "공동"].includes(
      lower
    )
  ) {
    return "함께";
  }
  return raw || "함께";
}

export function toTopics(v: unknown): TopicSection[] {
  if (!Array.isArray(v)) return [];
  const out: TopicSection[] = [];
  for (const row of v) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const points = toStringArray(r.points);
    if (!title || points.length === 0) continue;
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    out.push({ title, ...(summary && { summary }), points });
  }
  return out;
}

/** AI가 빈 칸 대신 적는 말. 화면에 "미정" 알약이 뜨지 않게 버린다. */
const EMPTY_VALUES = new Set(["미정", "없음", "-"]);

const ACTION_TEXT_KEYS = ["due", "context", "doneWhen", "quote", "goal", "why", "inputs", "how", "caution", "unsure"] as const;

function toActionItem(r: Record<string, unknown>): ActionItem | null {
  const task = str(r, "task");
  if (!task) return null;
  const item: ActionItem = { owner: normalizeOwner(r.owner), task };
  for (const key of ACTION_TEXT_KEYS) {
    const value = str(r, key);
    if (value && !EMPTY_VALUES.has(value)) item[key] = value;
  }
  const steps = toStringArray(r.steps).slice(0, 6);
  if (steps.length) item.steps = steps;
  return item;
}

export function toActionItems(v: unknown): ActionItem[] {
  return rows(v).flatMap((r) => toActionItem(r) ?? []);
}

function toAutomationLeads(v: unknown): AutomationLead[] {
  if (!Array.isArray(v)) return [];
  const leads: AutomationLead[] = [];
  for (const row of v) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const evidence =
      typeof value.evidence === "string" ? value.evidence.trim() : "";
    if (!title || !evidence) continue;
    leads.push({ title, evidence });
    if (leads.length === 3) break;
  }
  return leads;
}

function str(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v.trim() : "";
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    : [];
}

function toFlow(v: unknown): FlowStage[] {
  return rows(v).flatMap((row) => {
    const lane = str(row, "lane");
    const name = str(row, "name");
    if (!lane || !name) return [];
    const owner = str(row, "owner");
    const rule = str(row, "rule");
    const core = row.core === true;
    const quote = str(row, "quote");
    return [{ lane, name, ...(owner && { owner }), ...(rule && { rule }), ...(core && { core }), ...(quote && { quote }) }];
  });
}

function toRoles(v: unknown): PersonRole[] {
  const seen = new Set<string>();
  return rows(v).flatMap((row) => {
    const name = str(row, "name");
    const role = str(row, "role");
    if (!name || !role || seen.has(name)) return [];
    seen.add(name);
    const responsibilities = Array.isArray(row.responsibilities)
      ? row.responsibilities.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).slice(0, 4)
      : [];
    const decides = str(row, "decides");
    return [{ name, role, ...(responsibilities.length && { responsibilities }), ...(decides && { decides }) }];
  });
}

function toGlossary(v: unknown): GlossaryTerm[] {
  return rows(v)
    .flatMap((row) => {
      const term = str(row, "term");
      const definition = str(row, "definition");
      if (!term || !definition) return [];
      const distinction = str(row, "distinction");
      return [{ term, definition, ...(distinction && { distinction }) }];
    })
    .slice(0, 12);
}

function toPairs<K extends string, V extends string>(
  v: unknown,
  k: K,
  val: V
): Array<Record<K | V, string>> {
  return rows(v).flatMap((row) => {
    const a = str(row, k);
    const b = str(row, val);
    return a && b ? [{ [k]: a, [val]: b } as Record<K | V, string>] : [];
  });
}

/** 같은 날 일정은 한 줄로 합친다(AI가 "오늘"을 여러 줄로 쪼개는 일이 잦다). */
export function mergeSameDay(items: ScheduleItem[]): ScheduleItem[] {
  const map = new Map<string, string[]>();
  for (const { when, what } of items) map.set(when, [...(map.get(when) ?? []), what]);
  return [...map.entries()].map(([when, whats]) => ({ when, what: whats.join(" · ") }));
}

/** 목적·일정·핵심·후속 회의 — 없으면 키를 생략한다. */
function attachBrief(analysis: MeetingAnalysis, obj: Record<string, unknown>): void {
  const purpose = typeof obj.purpose === "string" ? obj.purpose.trim() : "";
  if (purpose) analysis.purpose = purpose;
  const schedule = mergeSameDay(toPairs(obj.schedule, "when", "what"));
  if (schedule.length) analysis.schedule = schedule;
  const highlights = toPairs(obj.highlights, "title", "detail");
  if (highlights.length) analysis.highlights = highlights;
  const followUps = toStringArray(obj.followUps);
  if (followUps.length) analysis.followUps = followUps;
}

/** 흐름·역할·용어 — 없으면 키를 생략한다. */
function attachStructure(analysis: MeetingAnalysis, obj: Record<string, unknown>): void {
  const flow = toFlow(obj.flow);
  if (flow.length) analysis.flow = flow;
  const roles = toRoles(obj.roles);
  if (roles.length) analysis.roles = roles;
  const glossary = toGlossary(obj.glossary);
  if (glossary.length) analysis.glossary = glossary;
}

/**
 * LLM 분석 JSON을 안전하게 파싱한다.
 * - 항상 렌더 가능: headline/summary 폴백 보장, keyPoints는 항상 배열.
 * - 적응형: 비어있거나 없는 선택 섹션은 키 자체를 생략.
 * - 절대 throw 하지 않는다(쓰레기 입력 → 최소 유효 분석).
 */
export function parseAnalysis(raw: string): MeetingAnalysis {
  const obj = extractObject(raw ?? "");

  const headlineRaw =
    obj && typeof obj.headline === "string" ? obj.headline.trim() : "";
  const summaryRaw =
    obj && typeof obj.summary === "string" ? obj.summary.trim() : "";

  const analysis: MeetingAnalysis = {
    headline: headlineRaw || "회의 기록",
    summary: summaryRaw || "요약을 생성하지 못했습니다.",
    keyPoints: obj ? toStringArray(obj.keyPoints) : [],
  };

  if (!obj) return analysis;

  const tag = normalizeMeetingTag(obj.tag);
  if (tag) analysis.tag = tag;

  const topics = toTopics(obj.topics);
  if (topics.length) analysis.topics = topics;

  const decisions = toStringArray(obj.decisions);
  if (decisions.length) analysis.decisions = decisions;

  const nextSteps = toStringArray(obj.nextSteps);
  if (nextSteps.length) analysis.nextSteps = nextSteps;

  // AI가 할 일을 nextSteps 에만 적는 경우가 잦다(10-13 회의 2건). 그러면 Todo로
  // 보낼 버튼이 사라지므로 nextSteps 를 담당 미정 할 일로 옮겨 담는다.
  const actionItems = toActionItems(obj.actionItems);
  if (actionItems.length) analysis.actionItems = actionItems;
  else if (nextSteps.length) {
    analysis.actionItems = nextSteps.map((task) => ({ owner: "미정", task }));
  }

  const openQuestions = toStringArray(obj.openQuestions);
  if (openQuestions.length) analysis.openQuestions = openQuestions;

  const automationLeads = toAutomationLeads(
    obj.automationLeads ?? obj.automationIdeas
  );
  if (automationLeads.length) analysis.automationLeads = automationLeads;

  attachBrief(analysis, obj);
  attachStructure(analysis, obj);
  return analysis;
}
