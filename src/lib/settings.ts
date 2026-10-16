// 설정 화면에서 넣은 키를 data/settings.json 에 두고 process.env 로 올린다.
// 서아님이 .env 파일을 직접 고치지 않게 하려는 것이다. 앱이 켜질 때(instrumentation.ts)와
// 저장할 때 한 번씩 적용한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SETTING_KEYS = ["IG_ACCESS_TOKEN", "IG_USER_ID", "ELEVENLABS_API_KEY", "OWNER_NAME"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = Partial<Record<SettingKey, string>>;

function settingsPath(): string {
  return path.join(process.cwd(), "data", "settings.json");
}

export function readSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
    const out: Settings = {};
    for (const k of SETTING_KEYS) if (typeof raw[k] === "string") out[k] = raw[k] as string;
    return out;
  } catch {
    return {};
  }
}

export function applySettings(s: Settings = readSettings()): void {
  for (const k of SETTING_KEYS) {
    const v = s[k]?.trim();
    if (v) process.env[k] = v;
  }
}

/** 빈 값은 기존 값을 지우지 않는다(화면에서 가린 칸을 그대로 저장해도 안전하게). */
export function saveSettings(patch: Settings): Settings {
  const next = { ...readSettings() };
  for (const k of SETTING_KEYS) {
    const v = patch[k]?.trim();
    if (v) next[k] = v;
  }
  mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  applySettings(next);
  return next;
}

/** 회의에서 "나"로 읽을 사람 이름. 설정에 없으면 서아. */
export function getOwnerName(): string {
  return process.env.OWNER_NAME?.trim() || readSettings().OWNER_NAME?.trim() || "서아";
}
