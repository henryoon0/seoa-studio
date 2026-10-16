"use client";

import { useState } from "react";
import type { ActionItem, ActionTodoLink, MeetingAnalysis, PersonRole } from "@/lib/meetings/types";
import { HighlightText } from "../highlighter";
import { EvidenceButton } from "./evidence-button";
import { evidenceFor } from "./summary-utils";

// 10-16 henry 레퍼런스: 숫자 카드 → 개수 탭 → 사람별 묶음 → 목표 아래 하위 할 일 → 자세히(목적·재료·방법·완료 기준·주의).
const CARD = "rounded-2xl bg-white shadow-[0px_0px_0px_1px_rgba(0,0,0,0.07),0px_1px_2px_rgba(0,0,0,0.04)]";
const UNASSIGNED = "담당 미정";
const OWNER_NAME: Record<string, string> = { 나: "나", 상대: "상대", 미정: UNASSIGNED };

interface Task {
  readonly item: ActionItem;
  readonly index: number;
}

export interface PersonTasks {
  readonly name: string;
  readonly role?: PersonRole;
  readonly roleIndex: number;
  readonly tasks: Task[];
}

/** 역할이 있는 사람 순서 → 할 일만 있는 사람 → 담당 미정 맨 끝. */
export function peopleCards(analysis: MeetingAnalysis): PersonTasks[] {
  const cards = new Map<string, PersonTasks>();
  (analysis.roles ?? []).forEach((role, roleIndex) =>
    cards.set(role.name, { name: role.name, role, roleIndex, tasks: [] })
  );
  (analysis.actionItems ?? []).forEach((item, index) => {
    const name = OWNER_NAME[item.owner] ?? item.owner;
    const card = cards.get(name) ?? { name, roleIndex: -1, tasks: [] };
    cards.set(name, { ...card, tasks: [...card.tasks, { item, index }] });
  });
  const all = [...cards.values()];
  return [...all.filter((c) => c.name !== UNASSIGNED), ...all.filter((c) => c.name === UNASSIGNED)];
}

/** 같은 goal 끼리 처음 나온 자리에 묶는다. goal 없는 일은 혼자 한 묶음. */
export function goalGroups(tasks: readonly Task[]): Array<{ goal?: string; tasks: Task[] }> {
  const groups: Array<{ goal?: string; tasks: Task[] }> = [];
  for (const task of tasks) {
    const goal = task.item.goal;
    const found = goal ? groups.find((g) => g.goal === goal) : undefined;
    if (found) found.tasks.push(task);
    else groups.push({ goal, tasks: [task] });
  }
  return groups;
}

const isToday = (due?: string) => Boolean(due && /오늘/.test(due));
/** 알약에 들어갈 짧은 기한만. 긴 조건형 기한은 자세히의 "기한" 줄로. */
const SHORT_DUE = 6;
const shortDue = (due?: string) => (due && due.length <= SHORT_DUE ? due : undefined);

export type TaskEdit = (index: number, patch: Pick<ActionItem, "task" | "owner">) => Promise<void>;

export function TaskBoard({
  meetingId,
  analysis,
  onTodo,
  onEdit,
}: {
  readonly meetingId: string;
  readonly analysis: MeetingAnalysis;
  readonly onTodo: (index: number, todo: ActionTodoLink) => void;
  readonly onEdit?: TaskEdit;
}) {
  const people = peopleCards(analysis);
  const [selected, setSelected] = useState<string>();
  if (!people.length) return null;
  const tasks = analysis.actionItems ?? [];
  const shown = selected ? people.filter((p) => p.name === selected) : people;
  return (
    <section className="space-y-5">
      <TaskStats analysis={analysis} people={people} />
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[17px] font-semibold text-neutral-950">
          할 일 <span className="font-normal text-neutral-500">· 사람별</span>
        </h2>
        <span className="text-[14px] text-neutral-600 tabular-nums">{tasks.length}개</span>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="사람으로 거르기">
        <Tab on={!selected} onClick={() => setSelected(undefined)} label="전체" count={tasks.length} />
        {people.filter((p) => p.tasks.length).map((p) => (
          <Tab key={p.name} on={selected === p.name} onClick={() => setSelected(p.name)} label={p.name} count={p.tasks.length} />
        ))}
      </div>
      {shown.filter((p) => p.tasks.length).map((person) => (
        <PersonBlock
          key={person.name}
          meetingId={meetingId}
          analysis={analysis}
          person={person}
          detailed={Boolean(selected)}
          onTodo={onTodo}
          onEdit={onEdit}
          names={people.map((p) => p.name)}
        />
      ))}
    </section>
  );
}

function TaskStats({ analysis, people }: { readonly analysis: MeetingAnalysis; readonly people: PersonTasks[] }) {
  const tasks = analysis.actionItems ?? [];
  const owners = people.filter((p) => p.tasks.length && p.name !== UNASSIGNED).length;
  const unassigned = people.find((p) => p.name === UNASSIGNED)?.tasks.length ?? 0;
  const stats = [
    { label: "할 일", value: tasks.length, sub: `${owners}명이 나눠 맡음`, dot: "" },
    { label: "오늘 마감", value: tasks.filter((t) => isToday(t.due)).length, sub: "기한이 오늘인 일", dot: "bg-red-500" },
    { label: "담당 미정", value: unassigned, sub: unassigned ? "담당을 정해야 함" : "모두 담당 있음", dot: unassigned ? "bg-amber-500" : "" },
    { label: "결정", value: analysis.decisions?.length ?? 0, sub: "회의에서 합의함", dot: "bg-emerald-500" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className={`${CARD} px-5 py-4`}>
          <p className="flex items-center gap-1.5 text-[14px] text-neutral-700">
            {s.label}
            {s.dot && <span className={`size-1.5 rounded-full ${s.dot}`} />}
          </p>
          <p className="mt-1 text-[32px] font-medium leading-tight text-neutral-950 tabular-nums">{s.value}</p>
          <p className="mt-1 text-[13px] text-neutral-600">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

function Tab({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-8 rounded-lg px-3 text-[14px] ${on ? "bg-neutral-200/70 font-medium text-neutral-950" : "text-neutral-700 hover:bg-neutral-100"}`}
    >
      {label} <span className="text-neutral-500 tabular-nums">{count}</span>
    </button>
  );
}

function PersonBlock({
  meetingId,
  analysis,
  person,
  detailed,
  onTodo,
  onEdit,
  names,
}: {
  readonly meetingId: string;
  readonly analysis: MeetingAnalysis;
  readonly person: PersonTasks;
  readonly detailed: boolean;
  readonly onTodo: (index: number, todo: ActionTodoLink) => void;
  readonly onEdit?: TaskEdit;
  readonly names: readonly string[];
}) {
  const rest = { meetingId, analysis, person: person.name, onTodo, onEdit, names };
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h3 className="shrink-0 text-[15px] font-semibold text-neutral-950">{person.name}</h3>
        {person.role && (
          <p className="min-w-0 truncate text-[14px] text-neutral-600" title={person.role.role}>
            · {person.role.role}
          </p>
        )}
        <span className="ml-auto shrink-0 text-[13px] text-neutral-600 tabular-nums">{person.tasks.length}개</span>
      </div>
      {detailed && person.role && <RoleDetails role={person.role} />}
      <div className={`${CARD} space-y-1 p-3`}>
        {goalGroups(person.tasks).map((group, i) =>
          group.goal && group.tasks.length > 1 ? (
            <GoalGroup key={group.goal} goal={group.goal} tasks={group.tasks} {...rest} />
          ) : (
            group.tasks.map((task) => (
              <TaskItem key={`${i}-${task.index}`} task={task} {...rest} />
            ))
          )
        )}
      </div>
    </div>
  );
}

function RoleDetails({ role }: { readonly role: PersonRole }) {
  return (
    <div className="mb-3 space-y-0.5 px-1 text-[14px] leading-relaxed text-neutral-800">
      {role.decides && (
        <p>
          <span className="font-semibold text-neutral-950">최종 결정</span> {role.decides}
        </p>
      )}
      {role.responsibilities?.map((r) => (
        <p key={r} className="flex gap-2">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-neutral-500" />
          {r}
        </p>
      ))}
    </div>
  );
}

interface ItemProps {
  readonly meetingId: string;
  readonly analysis: MeetingAnalysis;
  readonly person: string;
  readonly onTodo: (index: number, todo: ActionTodoLink) => void;
  readonly onEdit?: TaskEdit;
  readonly names: readonly string[];
}

function GoalGroup({ goal, tasks, ...rest }: ItemProps & { readonly goal: string; readonly tasks: Task[] }) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-3 px-2 py-1.5">
        <Box />
        <p className="text-[16px] font-bold text-neutral-950">{goal}</p>
        <span className="text-[13px] text-neutral-500 tabular-nums">{tasks.length}개</span>
      </div>
      <div className="ml-[17px] rounded-r-xl bg-neutral-50 py-1 pl-4 shadow-[inset_1px_0_0_0_rgba(0,0,0,0.10)]">
        {tasks.map((task) => (
          <TaskItem key={task.index} task={task} {...rest} />
        ))}
      </div>
    </div>
  );
}

/** 할 일 아래 하위 단계. 접어도 보이게 둔다(10-16 henry 예시의 세 번째 층). */
function StepList({ steps }: { readonly steps: readonly string[] }) {
  return (
    <ul className="ml-8 mt-1.5 space-y-1 rounded-lg bg-neutral-50 py-2 pl-3 pr-2 shadow-[inset_1px_0_0_0_rgba(0,0,0,0.10)]">
      {steps.map((step) => (
        <li key={step} className="flex items-center gap-2.5 text-[14px] leading-snug text-neutral-800">
          <span aria-hidden className="size-4 shrink-0 rounded bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]" />
          {step}
        </li>
      ))}
    </ul>
  );
}

function Box() {
  return <span aria-hidden className="size-5 shrink-0 rounded-md bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]" />;
}

function UnsurePill({ reason }: { readonly reason: string }) {
  return (
    <span title={reason} className="shrink-0 whitespace-nowrap rounded-full bg-amber-50 px-2.5 py-0.5 text-[13px] font-medium text-amber-700">
      확인 필요
    </span>
  );
}

function DuePill({ due }: { readonly due: string }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-medium tabular-nums ${
        isToday(due) ? "bg-red-50 text-red-600" : "bg-neutral-100 text-neutral-700"
      }`}
    >
      {due}
    </span>
  );
}

function TaskItem({ task, meetingId, analysis, person, onTodo, onEdit, names }: ItemProps & { readonly task: Task }) {
  const [open, setOpen] = useState(false);
  const { item, index } = task;
  return (
    <div className="px-2 py-1.5">
      <div className="flex items-center gap-3">
        <Box />
        {item.unsure && <UnsurePill reason={item.unsure} />}
        {shortDue(item.due) && <DuePill due={item.due ?? ""} />}
        <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-neutral-950">
          <HighlightText blockKey={`action:${index}`} text={item.task} />
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${item.task} ${open ? "접기" : "자세히"}`}
            className="ml-2 align-baseline text-[13px] font-normal text-neutral-500 hover:text-neutral-900"
          >
            {open ? "접기" : "자세히"}
          </button>
        </p>
        <EvidenceButton evidence={evidenceFor(analysis, "actionItem", index)} label={`${person} · ${item.task}`} />
      </div>
      {open && <TaskDetails item={item} meetingId={meetingId} index={index} onTodo={onTodo} onEdit={onEdit} names={names} />}
      {Boolean(item.steps?.length) && <StepList steps={item.steps ?? []} />}
    </div>
  );
}

/** 자세히: 목적·재료·방법·완료 기준·주의. 목적이 없으면 맥락을 목적 자리에. */
export function detailRows(item: ActionItem): Array<[string, string]> {
  const rows: Array<[string, string | undefined]> = [
    ["확인 필요", item.unsure],
    ["목적", item.why ?? item.context],
    ["재료", item.inputs],
    ["방법", item.how],
    ["완료 기준", item.doneWhen],
    ["기한", shortDue(item.due) ? undefined : item.due],
    ["주의", item.caution],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1]));
}

function TaskDetails({
  item,
  meetingId,
  index,
  onTodo,
  onEdit,
  names,
}: {
  readonly item: ActionItem;
  readonly meetingId: string;
  readonly index: number;
  readonly onTodo: (index: number, todo: ActionTodoLink) => void;
  readonly onEdit?: TaskEdit;
  readonly names: readonly string[];
}) {
  return (
    <div className="pb-2 pl-8 pt-3">
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-[15px] leading-relaxed">
        {detailRows(item).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-neutral-600">{label}</dt>
            <dd className="text-pretty text-neutral-900">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {onEdit && <TaskEditor item={item} names={names} onSave={(patch) => onEdit(index, patch)} />}
      </div>
    </div>
  );
}

/** 잘못 뽑힌 할 일을 그 자리에서 고친다. 고치면 "확인 필요"는 사라진다. */
function TaskEditor({
  item,
  names,
  onSave,
}: {
  readonly item: ActionItem;
  readonly names: readonly string[];
  readonly onSave: (patch: Pick<ActionItem, "task" | "owner">) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [task, setTask] = useState(item.task);
  const [owner, setOwner] = useState(item.owner === "미정" ? UNASSIGNED : item.owner);
  const [saving, setSaving] = useState(false);
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="min-h-8 text-[13px] text-neutral-600 hover:text-neutral-950">
        할 일 고치기
      </button>
    );
  }
  async function save() {
    setSaving(true);
    try {
      await onSave({ task: task.trim() || item.task, owner: owner === UNASSIGNED ? "미정" : owner });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
      <input
        aria-label="할 일"
        value={task}
        onChange={(e) => setTask(e.target.value)}
        className="h-9 min-w-60 flex-1 rounded-[10px] bg-neutral-50 px-3 text-[15px] text-neutral-950 shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
      />
      <select
        aria-label="담당"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        className="h-9 rounded-[10px] bg-neutral-50 px-2 text-[14px] shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
      >
        {[...new Set([...names, owner, UNASSIGNED])].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <button onClick={save} disabled={saving} className="h-9 rounded-[10px] bg-neutral-900 px-4 text-[14px] font-semibold text-white disabled:opacity-40">
        {saving ? "저장 중…" : "저장"}
      </button>
      <button onClick={() => setEditing(false)} className="h-9 px-2 text-[14px] text-neutral-600">취소</button>
    </div>
  );
}
