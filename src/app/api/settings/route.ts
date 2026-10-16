import { NextResponse } from "next/server";
import { IG_GRAPH_BASE } from "@/lib/instagram/graph-core";
import { runClaudeCLI } from "@/lib/ai/claude-cli";
import { readSettings, saveSettings, type Settings } from "@/lib/settings";

// 설정: GET = 저장된 키 현황(읽기 전용), POST = 키 저장 또는 {check} 연결 점검.
// 키 값 자체는 화면에 돌려주지 않는다(뒤 4자리만).

function mask(v: string | undefined): string | null {
  return v ? `····${v.slice(-4)}` : null;
}

type Check = { ok: boolean; detail: string };

async function checkInstagram(): Promise<Check> {
  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return { ok: false, detail: "토큰이 없어요" };
  try {
    const res = await fetch(`${IG_GRAPH_BASE}/me?fields=user_id,username`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { username?: string; error?: { message?: string } };
    return res.ok
      ? { ok: true, detail: `@${body.username} 계정과 연결됐어요` }
      : { ok: false, detail: body.error?.message ?? `인스타가 거절했어요 (${res.status})` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "인스타에 닿지 못했어요" };
  }
}

async function checkElevenLabs(): Promise<Check> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, detail: "키가 없어요" };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, detail: `ElevenLabs 가 거절했어요 (${res.status})` };
    const s = (await res.json()) as { character_count?: number; character_limit?: number };
    const left = (s.character_limit ?? 0) - (s.character_count ?? 0);
    return { ok: true, detail: `연결됐어요 · 남은 크레딧 ${left.toLocaleString("ko-KR")}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "ElevenLabs 에 닿지 못했어요" };
  }
}

async function checkClaude(): Promise<Check> {
  try {
    const out = await runClaudeCLI("숫자 1만 출력하세요.", { model: "haiku", timeoutMs: 60_000 });
    return out.trim() ? { ok: true, detail: "Claude 로그인 확인됐어요" } : { ok: false, detail: "Claude 가 빈 답을 줬어요" };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "Claude 를 부르지 못했어요" };
  }
}

function statusBody(checks: Record<string, Check>) {
  const s = readSettings();
  return {
    saved: { IG_ACCESS_TOKEN: mask(s.IG_ACCESS_TOKEN), ELEVENLABS_API_KEY: mask(s.ELEVENLABS_API_KEY) },
    checks,
  };
}

// GET 은 읽기만 한다. 밖으로 나가는 점검(Claude·인스타·ElevenLabs 호출)은 POST {check} 로만 돈다.
export async function GET() {
  return NextResponse.json(statusBody({}));
}

export async function POST(req: Request) {
  const body = (await req.json()) as Settings & { check?: string };
  if (typeof body.check === "string") {
    const which = body.check;
    const checks: Record<string, Check> = {};
    if (which === "instagram" || which === "all") checks.instagram = await checkInstagram();
    if (which === "elevenlabs" || which === "all") checks.elevenlabs = await checkElevenLabs();
    if (which === "claude" || which === "all") checks.claude = await checkClaude();
    return NextResponse.json(statusBody(checks));
  }
  const patch: Settings = {
    IG_ACCESS_TOKEN: body.IG_ACCESS_TOKEN,
    ELEVENLABS_API_KEY: body.ELEVENLABS_API_KEY,
  };
  // 인스타 토큰이 새로 들어오면 계정 번호도 같이 채운다(댓글 단 사람 찾기에 쓴다)
  if (patch.IG_ACCESS_TOKEN?.trim()) {
    try {
      const res = await fetch(`${IG_GRAPH_BASE}/me?fields=user_id`, {
        headers: { Authorization: `Bearer ${patch.IG_ACCESS_TOKEN.trim()}` },
        signal: AbortSignal.timeout(10_000),
      });
      const me = (await res.json()) as { user_id?: string };
      if (me.user_id) patch.IG_USER_ID = String(me.user_id);
    } catch {}
  }
  saveSettings(patch);
  return NextResponse.json({ ok: true });
}
