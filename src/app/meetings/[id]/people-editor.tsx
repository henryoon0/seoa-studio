"use client";
import { Icon } from "@/components/icon";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function PeopleEditor({
  meetingId,
  initialPeople,
  canWriteVault,
}: {
  meetingId: string;
  initialPeople: string[];
  /** status==="ready" && analysis 있음 — vault 기록이 일어나는지 안내용. */
  canWriteVault: boolean;
}) {
  const router = useRouter();
  const [people, setPeople] = useState<string[]>(initialPeople);
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/people", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setOptions(Array.isArray(j.names) ? j.names : []))
      .catch(() => setOptions([]));
  }, []);

  const query = input.trim();
  const suggestions = query
    ? options
        .filter((n) => n.includes(query) && !people.includes(n))
        .slice(0, 6)
    : [];

  function addPerson(name: string) {
    const n = name.trim();
    if (!n || people.includes(n)) return;
    setPeople((prev) => [...prev, n]);
    setInput("");
    inputRef.current?.focus();
  }

  function removePerson(name: string) {
    setPeople((prev) => prev.filter((p) => p !== name));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/people`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ people }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "저장 실패");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    people.length !== initialPeople.length ||
    people.some((p, i) => p !== initialPeople[i]);

  return (
    <section className="card p-5">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon name="users" className="size-4 text-neutral-600" />
        <h2 className="text-[13px] text-heading text-neutral-800">상대 태깅</h2>
      </div>

      {people.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {people.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] text-neutral-700 ring-1 ring-neutral-950/10"
            >
              {p}
              <button
                onClick={() => removePerson(p)}
                className="text-neutral-600 hover:text-neutral-700"
                aria-label={`${p} 제거`}
              >
                <Icon name="close" className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPerson(suggestions[0] ?? input);
              }
            }}
            placeholder="이름 입력 후 Enter (50_People 자동완성)"
            className="flex-1 px-2.5 py-1.5 rounded text-[13px] text-neutral-800 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/20 placeholder:text-neutral-600"
          />
          {query && (
            <button
              onClick={() => addPerson(input)}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-[12px] text-neutral-600 ring-1 ring-neutral-950/10 hover:ring-neutral-950/20"
            >
              <Icon name="plus" className="size-3.5" />
              추가
            </button>
          )}
        </div>

        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full bg-white rounded ring-1 ring-neutral-950/10 overflow-hidden">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  onClick={() => addPerson(s)}
                  className="block w-full text-left px-2.5 py-1.5 text-[13px] text-neutral-700 hover:bg-neutral-50 shadow-[0_-1px_0_0_rgba(10,10,10,0.05)] first:shadow-none"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}

      <div className="flex items-center justify-between mt-3">
        <p className="text-[12px] text-neutral-600">
          {canWriteVault
            ? "저장하면 그날 데일리노트와 인물 노트에 기록됩니다"
            : "분석 완료(ready) 후 저장하면 Obsidian에 기록됩니다"}
        </p>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[12px] text-white bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40"
        >
          <Icon name="check" className="size-3.5" />
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </section>
  );
}
