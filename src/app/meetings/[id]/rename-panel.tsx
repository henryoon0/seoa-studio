"use client";
import { Icon } from "@/components/icon";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 이름·단어 일괄 변경. 잘못 전사된 사람 이름(예: 은혜 → 은환)을
 * 전사·요약·공유본·태그 전체에서 한 번에 치환한다.
 * 실행된 치환은 별칭으로 저장돼 앞으로 새 회의 전사에 자동 적용된다.
 * 이 회의에서 찾지 못한 매핑도 "자동 매핑에 저장"으로 등록할 수 있다.
 */

interface NameAlias {
  from: string;
  to: string;
  createdAt: string;
}

export function RenamePanel({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [aliases, setAliases] = useState<NameAlias[]>([]);
  /** count=0 이었던 입력 — "자동 매핑에 저장" 제안 대상. */
  const [missed, setMissed] = useState<{ from: string; to: string } | null>(
    null
  );

  const loadAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings/name-aliases", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { aliases?: NameAlias[] };
      setAliases(json.aliases ?? []);
    } catch {
      /* 목록은 다음 기회에 */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/meetings/name-aliases", { cache: "no-store" })
      .then((res) =>
        res.ok ? (res.json() as Promise<{ aliases?: NameAlias[] }>) : null
      )
      .then((json) => {
        if (alive && json) setAliases(json.aliases ?? []);
      })
      .catch(() => {
        /* 목록은 다음 기회에 */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function run() {
    setLoading(true);
    setMessage(null);
    setIsError(false);
    setMissed(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "치환 실패");
      if (json.count === 0) {
        setMessage(`"${from.trim()}" 을(를) 이 회의에서 찾지 못했습니다`);
        setIsError(true);
        setMissed({ from: from.trim(), to: to.trim() });
      } else {
        setMessage(
          `${json.count}곳을 바꿨습니다 · 앞으로 새 회의에도 자동 적용됩니다`
        );
        setFrom("");
        setTo("");
        loadAliases();
        router.refresh();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "치환 실패");
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }

  /** 이 회의엔 없던 매핑을 앞으로의 회의를 위해 직접 저장한다. */
  async function saveMissedAlias() {
    if (!missed) return;
    setLoading(true);
    try {
      const res = await fetch("/api/meetings/name-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(missed),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "별칭 저장 실패");
      setAliases((json.aliases as NameAlias[]) ?? []);
      setMessage(
        `"${missed.from} → ${missed.to}" 을 저장했습니다 · 앞으로 새 회의에 자동 적용됩니다`
      );
      setIsError(false);
      setMissed(null);
      setFrom("");
      setTo("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "별칭 저장 실패");
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }

  async function removeAlias(aliasFrom: string) {
    try {
      const res = await fetch("/api/meetings/name-aliases", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: aliasFrom }),
      });
      const json = await res.json();
      if (res.ok) setAliases((json.aliases as NameAlias[]) ?? []);
    } catch {
      /* 다음 로드에서 수렴 */
    }
  }

  const ready = from.trim().length >= 2 && to.trim().length > 0;

  return (
    <section className="card p-5">
      <h2 className="text-[13px] text-heading text-neutral-800">
        이름 일괄 변경
      </h2>
      <p className="mt-0.5 text-[12px] text-neutral-600">
        잘못 적힌 이름을 전사·요약·공유본 전체에서 한 번에 바꿉니다 (2글자
        이상). 바꾼 이름은 기억해 뒀다가 다음 회의 전사부터 자동으로
        적용합니다.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="기존 (예: 은혜)"
          className="w-full rounded bg-white px-2 py-1.5 text-[13px] text-neutral-700 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/25"
        />
        <Icon name="arrow-right" className="size-3.5 shrink-0 text-neutral-300" />
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready && !loading) run();
          }}
          placeholder="새 이름 (예: 은환)"
          className="w-full rounded bg-white px-2 py-1.5 text-[13px] text-neutral-700 ring-1 ring-neutral-950/10 outline-none focus:ring-neutral-950/25"
        />
        <button
          onClick={run}
          disabled={!ready || loading}
          className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-[12px] text-white hover:bg-neutral-800 disabled:opacity-40"
        >
          {loading ? "변경 중..." : "바꾸기"}
        </button>
      </div>
      {message && (
        <p
          className={`mt-2 text-[12px] ${
            isError ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {message}
        </p>
      )}
      {missed && (
        <button
          onClick={saveMissedAlias}
          disabled={loading}
          className="mt-1.5 text-[12px] text-emerald-700 underline underline-offset-2 hover:text-emerald-800 disabled:opacity-40"
        >
          이 회의엔 없지만 앞으로 자동 변경되게 저장하기
        </button>
      )}
      {aliases.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-medium text-neutral-600">
            자동 매핑 {aliases.length}개 — 새 회의 전사에 자동 적용
          </h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {aliases.map((a) => (
              <li
                key={a.from}
                className="inline-flex items-center gap-1 rounded-full bg-neutral-950/[0.04] py-0.5 pl-2.5 pr-1 text-[12px] text-neutral-700"
              >
                <span className="text-neutral-400 line-through decoration-neutral-300">
                  {a.from}
                </span>
                <Icon name="arrow-right" className="size-3 text-neutral-300" />
                <span>{a.to}</span>
                <button
                  onClick={() => removeAlias(a.from)}
                  title="매핑 삭제"
                  className="ml-0.5 rounded-full p-0.5 text-neutral-400 hover:bg-neutral-950/5 hover:text-neutral-600"
                >
                  <Icon name="close" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
