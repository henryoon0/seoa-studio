// 인스타 DM 원장 — 디스크 영속화. 경로 계산은 여기에만 둔다 (CLAUDE.md 저장 모델 규칙).
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { createBlitzQueue, type BlitzQueueState } from "./blitz-queue";
import { createDmLedger, type DmLedger } from "./model";

export function instagramDmDir(): string {
  return process.env.INSTAGRAM_DM_DIR ?? path.join(process.cwd(), "data", "instagram-dm");
}

export function dmLedgerPath(): string {
  return path.join(instagramDmDir(), "ledger.json");
}

export async function readDmLedger(filePath = dmLedgerPath()): Promise<DmLedger> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DmLedger>;
    return {
      conversations: parsed.conversations ?? {},
      sync: parsed.sync ?? {},
      me: parsed.me,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return createDmLedger();
    throw error;
  }
}

export async function writeDmLedger(ledger: DmLedger, filePath = dmLedgerPath()): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}


// ── DM 쳐내기 발송 대기줄 ─────────────────────────────────

export function blitzQueuePath(): string {
  return path.join(instagramDmDir(), "blitz-queue.json");
}

export async function readBlitzQueue(filePath = blitzQueuePath()): Promise<BlitzQueueState> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<BlitzQueueState>;
    return {
      items: parsed.items ?? [],
      status: parsed.status ?? "idle",
      stopReason: parsed.stopReason,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return createBlitzQueue();
    throw error;
  }
}

export async function writeBlitzQueue(state: BlitzQueueState, filePath = blitzQueuePath()): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
