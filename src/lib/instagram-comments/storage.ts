// 인스타 댓글 검토함 — 디스크 영속화. 경로 계산은 여기에만 둔다 (CLAUDE.md 저장 모델 규칙).
import { chmod, mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import path from "path";
import { createLedger, dict, type IgCommentLedger } from "./model";
import { createQueue, type SendQueueState } from "./queue-model";

export function instagramCommentsDir(): string {
  return process.env.INSTAGRAM_COMMENTS_DIR ?? path.join(process.cwd(), "data", "instagram-comments");
}

// ── 쓰기 안전장치 ─────────────────────────────────────────
// 원장·대기줄은 동기화·발송기·초안 잡·API 가 동시에 고친다. 파일마다 약속 사슬 하나로
// 읽기-수정-쓰기를 줄 세우고(이 프로세스 안 단일 작성자), 쓰기는 임시 파일 → rename 으로
// 반쯤 쓴 JSON 이 남지 않게 한다. 폴더는 0700, 파일은 0600 (토큰이 같은 폴더에 있다).

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function lockChains(): Map<string, Promise<unknown>> {
  const g = globalThis as typeof globalThis & { __igFileLocks?: Map<string, Promise<unknown>> };
  g.__igFileLocks ??= new Map();
  return g.__igFileLocks;
}

/** 같은 파일에 대한 작업을 하나씩 실행한다. 앞 작업이 실패해도 사슬은 이어진다. */
export function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const chains = lockChains();
  const prev = chains.get(filePath) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(filePath, run.catch(() => undefined));
  return run;
}

async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  await chmod(dir, DIR_MODE);
}

/** 임시 파일에 0600 으로 쓰고 rename — 원자적 교체. */
export async function writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
  await ensurePrivateDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data, { mode: FILE_MODE });
  await chmod(tmp, FILE_MODE);
  await rename(tmp, filePath);
}

/**
 * 이전 버전이 0644·0755 로 만든 비밀 파일·폴더의 권한을 고친다 (서버 시작 때 한 번).
 * 유효한 토큰은 다시 쓰지 않으니 쓰기 시점의 0600 만으로는 기존 파일이 안 고쳐진다.
 * 없는 경로는 건너뛴다. 실패한 경로 이름만 돌려준다(내용은 읽지 않는다).
 */
export async function hardenPrivatePaths(paths: { dirs: string[]; files: string[] }): Promise<string[]> {
  const failed: string[] = [];
  const fix = async (p: string, mode: number) => {
    try {
      await chmod(p, mode);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) failed.push(p);
    }
  };
  for (const d of paths.dirs) await fix(d, DIR_MODE);
  for (const f of paths.files) await fix(f, FILE_MODE);
  return failed;
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function ledgerPath(): string {
  return path.join(instagramCommentsDir(), "ledger.json");
}

// ── 게시물 이미지 디스크 캐시 ──────────────────────────────
// CDN 서명 URL 은 만료돼도 이미지 바이트 자체는 안 변한다. 한번 받으면 저장해두고 재사용한다.
export function mediaCacheDir(): string {
  return path.join(instagramCommentsDir(), "media-cache");
}

function mediaCachePath(mediaId: string): string {
  const safe = mediaId.replace(/[^A-Za-z0-9_]/g, "");
  return path.join(mediaCacheDir(), `${safe}.jpg`);
}

/** 캐시된 이미지 바이트. 없거나 maxAgeMs 보다 오래됐으면 null. */
export async function readCachedMediaImage(mediaId: string, maxAgeMs: number): Promise<Buffer | null> {
  const p = mediaCachePath(mediaId);
  try {
    const info = await stat(p);
    if (Date.now() - info.mtimeMs > maxAgeMs) return null;
    return await readFile(p);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeCachedMediaImage(mediaId: string, bytes: Buffer): Promise<void> {
  const p = mediaCachePath(mediaId);
  await writeFileAtomic(p, bytes);
}

export function tokenPath(): string {
  return path.join(instagramCommentsDir(), "token.json");
}

export interface StoredToken {
  accessToken: string;
  refreshedAt: string;
  expiresAt: string;
  /** 이 토큰의 씨앗이 된 .env.local IG_ACCESS_TOKEN 값. env 에 새 토큰을 붙여넣었는지 판별하는 기준. */
  seedToken?: string;
}

export async function readLedger(filePath = ledgerPath()): Promise<IgCommentLedger> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<IgCommentLedger>;
    return {
      media: dict(parsed.media),
      comments: dict(parsed.comments),
      people: dict(parsed.people),
      sync: parsed.sync ?? {},
      myCommentIds: parsed.myCommentIds ?? [],
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return createLedger();
    throw error;
  }
}

/**
 * 원장 통째 덮어쓰기. 읽은 뒤 고쳐 쓰는 곳은 이걸 쓰지 말고 updateLedger 를 쓴다 —
 * 그 사이 다른 작성자의 변경(초안·발송 기록)을 지우기 때문이다.
 */
export async function writeLedger(ledger: IgCommentLedger, filePath = ledgerPath()): Promise<void> {
  await withFileLock(filePath, () => writeFileAtomic(filePath, toJson(ledger)));
}

/** 잠금 안에서 최신 원장을 읽어 fn 으로 고치고 저장한다. fn 이 같은 객체를 돌려주면 쓰지 않는다. */
export async function updateLedger(
  fn: (ledger: IgCommentLedger) => IgCommentLedger | Promise<IgCommentLedger>,
  filePath = ledgerPath()
): Promise<IgCommentLedger> {
  return withFileLock(filePath, async () => {
    const current = await readLedger(filePath);
    const next = await fn(current);
    if (next !== current) await writeFileAtomic(filePath, toJson(next));
    return next;
  });
}

export async function readStoredToken(filePath = tokenPath()): Promise<StoredToken | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    if (!parsed.accessToken) return null;
    return parsed as StoredToken;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeStoredToken(token: StoredToken, filePath = tokenPath()): Promise<void> {
  await withFileLock(filePath, () => writeFileAtomic(filePath, toJson(token)));
}

// ── 발송 대기줄 (#81) ─────────────────────────────────────

export function sendQueuePath(): string {
  return path.join(instagramCommentsDir(), "send-queue.json");
}

export async function readSendQueue(filePath = sendQueuePath()): Promise<SendQueueState> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SendQueueState>;
    return {
      items: parsed.items ?? [],
      status: parsed.status ?? "idle",
      stopReason: parsed.stopReason,
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return createQueue();
    throw error;
  }
}

export async function writeSendQueue(state: SendQueueState, filePath = sendQueuePath()): Promise<void> {
  await withFileLock(filePath, () => writeFileAtomic(filePath, toJson(state)));
}

/** 잠금 안에서 최신 대기줄을 읽어 fn 으로 고치고 저장한다. 담기·회수·발송권 확보가 전부 이걸 지난다. */
export async function updateSendQueue(
  fn: (state: SendQueueState) => SendQueueState,
  filePath = sendQueuePath()
): Promise<SendQueueState> {
  return withFileLock(filePath, async () => {
    const current = await readSendQueue(filePath);
    const next = fn(current);
    if (next !== current) await writeFileAtomic(filePath, toJson(next));
    return next;
  });
}

// ── 컨텍스트 사실 (선질문 답변 저장, #66) ─────────────────
// 가격·녹화본 정책처럼 반복되는 사실. 한 번 답하면 다음 생성부터 재사용한다.

export interface StoredFact {
  question: string;
  answer: string;
  savedAt: string;
}

export function factsPath(): string {
  return path.join(instagramCommentsDir(), "facts.json");
}

export async function readFacts(filePath = factsPath()): Promise<StoredFact[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredFact[]) : [];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeFacts(facts: StoredFact[], filePath = factsPath()): Promise<void> {
  await withFileLock(filePath, () => writeFileAtomic(filePath, toJson(facts)));
}

/** 잠금 안에서 최신 사실을 읽어 fn 으로 고치고 저장한다. 동시에 들어온 답변이 서로 덮어쓰지 않는다. */
export async function updateFacts(
  fn: (facts: StoredFact[]) => StoredFact[],
  filePath = factsPath()
): Promise<StoredFact[]> {
  return withFileLock(filePath, async () => {
    const next = fn(await readFacts(filePath));
    await writeFileAtomic(filePath, toJson(next));
    return next;
  });
}

// ── 초안 일괄 생성 잡 (#66) ───────────────────────────────

export interface DraftJob {
  id: string;
  /** "all" 또는 mediaId — 전체 초안 작성 / 게시물 단위 생성 */
  scope: string;
  commentIds: string[];
  done: string[];
  failed: { commentId: string; error: string }[];
  status: "running" | "done" | "stopped";
  createdAt: string;
  /** heartbeat — 댓글 1건 처리마다 갱신, sweep stale 판정용 */
  updatedAt: string;
}

export function draftJobPath(): string {
  return path.join(instagramCommentsDir(), "draft-job.json");
}

export async function readDraftJob(filePath = draftJobPath()): Promise<DraftJob | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DraftJob>;
    if (!parsed.id || !Array.isArray(parsed.commentIds)) return null;
    return {
      id: parsed.id,
      scope: parsed.scope ?? "all",
      commentIds: parsed.commentIds,
      done: parsed.done ?? [],
      failed: parsed.failed ?? [],
      status: parsed.status ?? "done",
      createdAt: parsed.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeDraftJob(job: DraftJob, filePath = draftJobPath()): Promise<void> {
  await withFileLock(filePath, () => writeFileAtomic(filePath, toJson(job)));
}
