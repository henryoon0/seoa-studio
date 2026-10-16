"use client";
import { Icon } from "@/components/icon";

import type { ActionDraft, TopicDraft } from "./summary-utils";

const inputClass =
  "rounded bg-white px-2 py-1 text-[13px] text-neutral-700 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/25";

export function EditCard({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-heading text-[12px] text-neutral-700">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LineArea({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={3}
      className="w-full resize-y rounded bg-white p-2 text-[13px] leading-6 text-neutral-700 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/25"
    />
  );
}

export function TopicFields({
  topics,
  onChange,
}: {
  readonly topics: TopicDraft[];
  readonly onChange: (topics: TopicDraft[]) => void;
}) {
  return (
    <EditCard
      title="나눈 이야기 (주제별)"
      action={<AddButton label="주제 추가" onClick={() => onChange([...topics, { title: "", points: "" }])} />}
    >
      <div className="space-y-3">
        {topics.length === 0 && <Empty text="주제가 없습니다." />}
        {topics.map((topic, index) => (
          <div key={index} className="rounded bg-neutral-950/[0.02] p-2.5">
            <div className="flex items-center gap-2">
              <input
                value={topic.title}
                onChange={(event) =>
                  onChange(topics.map((item, i) => i === index ? { ...item, title: event.target.value } : item))
                }
                placeholder="주제 제목"
                className={`${inputClass} w-full font-medium text-neutral-800`}
              />
              <RemoveButton label="주제 삭제" onClick={() => onChange(topics.filter((_, i) => i !== index))} />
            </div>
            <textarea
              value={topic.points}
              onChange={(event) =>
                onChange(topics.map((item, i) => i === index ? { ...item, points: event.target.value } : item))
              }
              rows={3}
              placeholder="한 줄에 하나씩"
              className="mt-2 w-full resize-y rounded bg-white p-2 text-[13px] leading-6 text-neutral-700 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/25"
            />
          </div>
        ))}
      </div>
    </EditCard>
  );
}

export function ActionFields({
  actions,
  onChange,
}: {
  readonly actions: ActionDraft[];
  readonly onChange: (actions: ActionDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<ActionDraft>) =>
    onChange(actions.map((item, i) => i === index ? { ...item, ...patch } : item));
  return (
    <EditCard
      title="할 일"
      action={<AddButton label="추가" onClick={() => onChange([...actions, { owner: "함께", task: "", due: "" }])} />}
    >
      <div className="space-y-2">
        {actions.length === 0 && <Empty text="할 일이 없습니다." />}
        {actions.map((action, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <input value={action.owner} onChange={(e) => update(index, { owner: e.target.value })}
              placeholder="담당" className={`${inputClass} w-20 shrink-0 text-[12px]`} />
            <input value={action.task} onChange={(e) => update(index, { task: e.target.value })}
              placeholder="할 일" className={`${inputClass} min-w-48 flex-1`} />
            <input value={action.due} onChange={(e) => update(index, { due: e.target.value })}
              placeholder="YYYY-MM-DD" className={`${inputClass} tnum w-28 shrink-0 text-[12px] text-neutral-500`} />
            <RemoveButton label="할 일 삭제" onClick={() => onChange(actions.filter((_, i) => i !== index))} />
          </div>
        ))}
      </div>
    </EditCard>
  );
}

function AddButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex min-h-8 items-center gap-0.5 text-[12px] text-neutral-500 hover:text-neutral-700">
      <Icon name="plus" className="size-3.5" /> {label}
    </button>
  );
}

function RemoveButton({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} className="min-h-8 min-w-8 text-neutral-300 hover:text-red-500">
      <Icon name="close" className="mx-auto size-4" />
    </button>
  );
}

function Empty({ text }: { readonly text: string }) {
  return <p className="text-[12px] text-neutral-500">{text}</p>;
}
