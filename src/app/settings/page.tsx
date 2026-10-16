"use client";

import { useCallback, useEffect, useState } from "react";

// 설정: 앱이 쓰는 연결 3개(Claude·인스타·ElevenLabs)를 한 화면에서 넣고 확인한다.

type Check = { ok: boolean; detail: string };
type Status = {
  saved: { IG_ACCESS_TOKEN: string | null; ELEVENLABS_API_KEY: string | null };
  checks: Record<string, Check>;
};

function CheckLine({ check, busy }: { check?: Check; busy: boolean }) {
  if (busy) return <p className="text-[13px] text-neutral-500">확인하는 중…</p>;
  if (!check) return null;
  return (
    <p className={`text-[13px] ${check.ok ? "text-emerald-700" : "text-red-600"}`}>
      {check.ok ? "✓ " : "✕ "}
      {check.detail}
    </p>
  );
}

function Card({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="card rounded-2xl bg-white p-5 shadow-[0_0_0_1px_rgba(10,10,10,0.06)]">
      <h2 className="text-[15px] font-semibold text-neutral-950">{title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-neutral-600">{desc}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function KeyField({
  label,
  saved,
  onSave,
}: {
  label: string;
  saved: string | null;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={saved ? `저장됨 ${saved} · 바꾸려면 새로 붙여 넣기` : `${label} 붙여 넣기`}
        className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-[14px] outline-none focus:border-neutral-400"
      />
      <button
        type="button"
        disabled={!value.trim() || saving}
        onClick={async () => {
          setSaving(true);
          await onSave(value.trim());
          setValue("");
          setSaving(false);
        }}
        className="rounded-lg bg-neutral-900 px-4 text-[13px] font-medium text-white disabled:opacity-40"
      >
        {saving ? "저장 중" : "저장"}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const run = useCallback(async (which: string) => {
    setBusy((b) => ({ ...b, [which]: true }));
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ check: which }),
    });
    const next = (await res.json()) as Status;
    setStatus((prev) => ({ saved: next.saved, checks: { ...(prev?.checks ?? {}), ...next.checks } }));
    setBusy((b) => ({ ...b, [which]: false }));
  }, []);

  useEffect(() => {
    void run("all");
  }, [run]);

  const save = (key: "IG_ACCESS_TOKEN" | "ELEVENLABS_API_KEY", which: string) => async (value: string) => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    await run(which);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
      <h1 className="text-[22px] font-semibold text-neutral-950">설정</h1>

      <Card
        title="AI 연결 (Claude)"
        desc="답글 초안과 회의 요약을 Claude 가 씁니다. 처음 한 번 터미널에서 claude 를 실행해 로그인하면 됩니다."
      >
        <CheckLine check={status?.checks.claude} busy={busy.claude || (busy.all && !status)} />
        <button type="button" onClick={() => run("claude")} className="text-[13px] font-medium text-neutral-700 underline">
          다시 확인
        </button>
      </Card>

      <Card
        title="인스타 연결"
        desc="henry 가 보내 드린 인스타 토큰을 붙여 넣으세요. 저장하면 바로 연결을 확인합니다. 토큰은 60일마다 앱이 스스로 연장합니다."
      >
        <KeyField label="인스타 토큰" saved={status?.saved.IG_ACCESS_TOKEN ?? null} onSave={save("IG_ACCESS_TOKEN", "instagram")} />
        <CheckLine check={status?.checks.instagram} busy={busy.instagram || (busy.all && !status)} />
      </Card>

      <Card
        title="회의 받아쓰기 (ElevenLabs)"
        desc="회의 녹음을 글로 바꿀 때 씁니다. elevenlabs.io 의 Developers › API Keys 에서 만든 키를 붙여 넣으세요."
      >
        <KeyField label="ElevenLabs API 키" saved={status?.saved.ELEVENLABS_API_KEY ?? null} onSave={save("ELEVENLABS_API_KEY", "elevenlabs")} />
        <CheckLine check={status?.checks.elevenlabs} busy={busy.elevenlabs || (busy.all && !status)} />
      </Card>
    </div>
  );
}
