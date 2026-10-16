// 녹음 상태 읽기·토글 — 녹음 스크립트(scripts/recording/meeting-record.sh)와
// 같은 상태 파일(~/Library/Application Support/SimplyhomeStudio/recording/meeting-record.pid)을 읽고, 토글도 그 스크립트를 그대로 실행한다.
//
// 6시간 방치 사고(2026-07-18, 50분 회의가 5.9시간 녹음 → whisper 무음 환각)의 재발
// 방지가 목적: 대시보드에서 녹음이 "보이게" 하고, 오래 돌면 경고를 띄운다.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const STATE_FILE =
  process.env.MEETING_RECORD_STATE ||
  path.join(
    os.homedir(),
    "Library/Application Support/SimplyhomeStudio/recording/meeting-record.pid"
  );

/** 녹음 원본 폴더. 스크립트의 REC_DIR 기본값과 같다. */
const REC_DIR = process.env.REC_DIR || path.join(os.homedir(), "Recordings/meetings");

/**
 * 시작·종료 요청을 이 서버 안에서 한 줄로 세운다.
 * 시작이 도는 중(상태 파일 생성 전)에 온 종료도 시작이 끝난 뒤 실행돼 녹음을 멈춘다.
 */
let recordingChain: Promise<unknown> = Promise.resolve();
export function runRecordingExclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = recordingChain.then(task, task);
  recordingChain = next.catch(() => undefined);
  return next;
}

/**
 * 서버 시작 때 기존 녹음 권한을 본인 전용으로 고친다(폴더 700, 파일 600).
 * 예전 스크립트는 umask 022 로 다른 사용자도 읽을 수 있게 만들었다.
 */
export async function hardenRecordingPaths(root = REC_DIR): Promise<string[]> {
  const failed: string[] = [];
  const walk = async (dir: string) => {
    try {
      await fs.chmod(dir, 0o700);
    } catch {
      failed.push(dir);
      return;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      failed.push(dir);
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) await fs.chmod(p, 0o600).catch(() => failed.push(p));
    }
  };
  try {
    if (!(await fs.stat(root)).isDirectory()) return failed;
  } catch {
    return failed; // 아직 녹음한 적이 없다.
  }
  await walk(root);
  return failed;
}

/** 스크립트의 감시자가 이 서버 PID 가 죽으면 녹음을 멈춘다. */
function scriptEnv(intent: "start" | "stop"): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MEETING_RECORD_INTENT: intent,
    MEETING_RECORD_STATE: STATE_FILE,
    MEETING_SERVER_PID: String(process.pid),
  };
}

export interface RecordingStatus {
  recording: boolean;
  mode?: "remote" | "inperson";
  /** ISO — 파일명 타임스탬프(로컬) 기준, 실패 시 파일 birthtime. */
  startedAt?: string;
  elapsedSec?: number;
  file?: string;
  /** 종료 시도가 실패했을 때 사유(녹음 프로세스가 안 꺼짐 등). 녹음은 계속 켜진 상태다. */
  stopError?: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 네이티브 세션 경로나 레거시 m4a 파일명에서 로컬 시작 시각을 읽는다. */
export function startFromRecordingPath(file: string): Date | null {
  const m =
    /meeting_(?:remote|inperson)_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:\/|\.m4a$)/.exec(
      file
    );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const dt = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export async function readRecordingStatus(): Promise<RecordingStatus> {
  let raw: string;
  try {
    raw = await fs.readFile(STATE_FILE, "utf-8");
  } catch {
    return { recording: false };
  }
  const [pidLine, file, modeLine] = raw.split("\n");
  const pid = Number.parseInt(pidLine ?? "", 10);
  if (!Number.isFinite(pid) || !pidAlive(pid)) {
    return { recording: false };
  }
  const mode = modeLine === "inperson" ? "inperson" : "remote";
  let started = file ? startFromRecordingPath(file) : null;
  if (!started && file) {
    try {
      started = (await fs.stat(file)).birthtime;
    } catch {
      started = null;
    }
  }
  const startedAt = started?.toISOString();
  const elapsedSec = started
    ? Math.max(0, Math.round((Date.now() - started.getTime()) / 1000))
    : undefined;
  const stopError = (
    await fs.readFile(`${STATE_FILE}.stop-error`, "utf-8").catch(() => "")
  ).trim();
  return {
    recording: true,
    mode,
    startedAt,
    elapsedSec,
    file,
    ...(stopError ? { stopError } : {}),
  };
}

function scriptPath(): string {
  return (
    process.env.MEETING_RECORD_SCRIPT ||
    path.join(/*turbopackIgnore: true*/ process.cwd(), "scripts/recording/meeting-record.sh")
  );
}

/**
 * 녹음 종료 — 스크립트를 detached 로 띄우고 즉시 돌아온다(이미 꺼졌으면 아무것도 안 한다).
 * 종료 쪽은 스크립트가 업로드(ingest)까지 이어가므로 기다리지 않는다(UI 는 폴링).
 */
export function stopRecording(): void {
  const script = scriptPath();
  const child = spawn("bash", [script, "--stop"], {
    detached: true,
    stdio: "ignore",
    env: scriptEnv("stop"),
  });
  child.unref();
}

export interface StartRecordingResult {
  ok: boolean;
  /** 스크립트 stdout+stderr 전체(진단용). */
  output: string;
  /** ❌ 실패 사유 한 줄(있으면). */
  error?: string;
  /** ⚠️ 경고 라인들(출력 자동전환 실패 등 — 녹음은 시작됨). */
  warnings: string[];
}

/**
 * 녹음 시작 전용 — 스크립트 출력을 캡처해 실패 사유·경고를 돌려준다.
 * 시작 스크립트는 마이크 프로브(2초) 포함 수 초 안에 끝난다. detached 토글은
 * 이 메시지를 통째로 버려서, 덮개 닫힘·마이크 무음 거부가 대시보드에서
 * "그냥 안 되는" 경험이 됐었다(2026-07-24).
 */
export function startRecordingCaptured(
  mode?: "remote" | "inperson",
  timeoutMs = 25_000
): Promise<StartRecordingResult> {
  const script = scriptPath();
  return new Promise((resolve) => {
    const child = spawn("bash", mode ? [script, mode] : [script], {
      env: scriptEnv("start"),
    });
    let out = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      const lines = out.split("\n");
      const errLine = lines.find((l) => l.includes("❌"));
      resolve({
        ok,
        output: out,
        ...(ok
          ? {}
          : { error: (errLine ?? "녹음 시작 실패").replace("❌", "").trim() }),
        warnings: lines
          .filter((l) => l.includes("⚠️"))
          .map((l) => l.replace("⚠️", "").trim()),
      });
    };
    // 스크립트가 걸려도 응답은 돌려준다(녹음 여부는 상태 폴링이 수렴).
    const timer = setTimeout(() => finish(true), timeoutMs);
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (out += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      out += String(e);
      finish(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0);
    });
  });
}
