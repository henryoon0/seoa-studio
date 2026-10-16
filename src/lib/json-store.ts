/**
 * One home for the repo-local JSON read/write mechanics.
 *
 * Most feature stores (income.ts, buyers.ts, the deposit inboxes, …) hand-rolled the
 * same four things: resolve a path (env override + data/ default), read-or-fall-back,
 * mkdir -p, and write pretty JSON. That left no locality — a change to how we persist
 * (atomic writes, owner-only perms for credential files, a schema-version stamp) had
 * to be repeated ~22 times. This module owns those mechanics once.
 *
 * Two layers:
 *  - {@link readJsonAt} / {@link writeJsonAt} — path-based primitives. Use these when
 *    the path is already resolved (e.g. one store backing several files).
 *  - {@link jsonStore} — the ergonomic factory for a single flat store: give it a file
 *    name, an env override, and a fallback, and it hands back read/write/path.
 *
 * Read policy: any read or parse error (missing file, corrupt JSON) yields a fresh
 * copy of the fallback. This matches what every flat store did and keeps one bad file
 * from taking down a feature. Stores that must distinguish "missing" from "corrupt"
 * keep their own try/catch and are not migrated here.
 */

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "node:crypto";

export interface ReadJsonOptions {
  /**
   * Re-throw on anything other than a missing file (e.g. corrupt JSON) instead of
   * falling back. Matches stores that would rather surface a broken file than
   * silently read it as empty. Default false: any error → fallback.
   */
  strict?: boolean;
}

/**
 * Read a JSON file. Missing file → a fresh copy of `fallback`. By default any other
 * error (corrupt JSON, permissions) also falls back; with `strict` it re-throws.
 */
export async function readJsonAt<T>(
  filePath: string,
  fallback: T,
  opts: ReadJsonOptions = {}
): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if (opts.strict && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // structuredClone so callers can mutate the result without poisoning the next read.
    return structuredClone(fallback);
  }
}

// ── mtime 캐시 읽기 ────────────────────────────────────────────────────────────
//
// 폴링 API(nav-badges 등)가 큰 JSON(수 MB)을 10초마다 재파싱하면, 디스크가
// 붐빌 때(브라우저 수집·Turbopack 캐시 쓰기) 그 비용이 수십 배로 튄다.
// stat 1번으로 inode+mtime+size 가 같으면 파싱 결과를 재사용한다.
//
// 반환값은 매번 structuredClone — 호출처가 mutate 해도 캐시가 오염되지 않는다
// (readJsonAt 의 fallback 정책과 같은 계약). writeJsonAt 은 저장 후 캐시를
// 무효화한다. 진행 중이던 읽기가 옛 파일을 뒤늦게 캐시해도 새 inode 와 안 맞는다.
const jsonReadCache = new Map<
  string,
  { ino: number; mtimeMs: number; size: number; value: unknown }
>();

export async function readJsonCachedAt<T>(
  filePath: string,
  fallback: T,
  opts: ReadJsonOptions = {}
): Promise<T> {
  try {
    const st = await fs.stat(filePath);
    const hit = jsonReadCache.get(filePath);
    if (hit && hit.ino === st.ino && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      return structuredClone(hit.value) as T;
    }
    const raw = await fs.readFile(filePath, "utf-8");
    const value = JSON.parse(raw) as T;
    jsonReadCache.set(filePath, { ino: st.ino, mtimeMs: st.mtimeMs, size: st.size, value });
    return structuredClone(value) as T;
  } catch (err) {
    if (opts.strict && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return structuredClone(fallback);
  }
}

export interface WriteJsonOptions {
  /** Owner-only perms (file 0600, dir 0700) — for credential-bearing files. */
  secret?: boolean;
}

/**
 * mkdir -p the parent, write a complete sibling file, then atomically replace
 * the live JSON. A stopped process can leave an ignorable temp file, but never
 * a truncated store at `filePath`.
 */
export async function writeJsonAt(
  filePath: string,
  data: unknown,
  opts: WriteJsonOptions = {}
): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await fs.mkdir(directory, {
    recursive: true,
    ...(opts.secret ? { mode: 0o700 } : {}),
  });
  const handle = await fs.open(temporaryPath, "wx", opts.secret ? 0o600 : 0o666);
  try {
    await handle.writeFile(json, "utf-8");
    await handle.sync();
    await handle.close();
    await fs.rename(temporaryPath, filePath);
    if (opts.secret) await fs.chmod(filePath, 0o600);
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  jsonReadCache.delete(filePath);
}

export interface JsonStoreConfig<T> {
  /** Filename (or path relative to the data dir), e.g. "income.json". */
  file: string;
  /** Value returned when the file is missing or unreadable (returned as a fresh copy). */
  fallback: T;
  /** Env var that overrides the full file path (e.g. "INCOME_DATA_PATH"). */
  envVar?: string;
  /** Env var that overrides the parent directory (e.g. "WEEKLY_FOCUS_DATA_DIR"). */
  dirEnvVar?: string;
  /** Owner-only perms for credential-bearing files. */
  secret?: boolean;
  /** Re-throw on corrupt JSON instead of falling back (see {@link ReadJsonOptions}). */
  strict?: boolean;
}

export interface JsonStore<T> {
  /** Resolve the on-disk path (lazily — reads env at call time, like the originals). */
  path(): string;
  /** Parse the file as JSON, or a fresh fallback on any read/parse error. */
  read(): Promise<T>;
  /** mkdir -p the parent and write the value as pretty JSON. */
  write(data: T): Promise<void>;
}

// ── 디렉터리형 스토어: {dir}/{id}.json 레코드 묶음 ──────────────────────────────
//
// quote·engagements·proposals·meetings 등 ~15개 기능이 같은 뼈대(ensureDir
// → filePath(id) → read+parse+catch → readdir 루프 → pretty write → unlink)를 각자
// 타이핑했다. jsonStore 가 플랫 파일 1개를 맡듯 이 factory 가 그 뼈대를 맡는다.
//
// 쓰기는 원자적이다: 같은 디렉터리의 tmp 파일에 먼저 쓰고 rename 한다. 중간에
// 프로세스가 죽어도 반쪽짜리 JSON 이 {id}.json 을 덮지 않는다 (list/get 의
// ".json" 필터가 tmp 파일을 자연스럽게 걸러낸다).
//
// 읽기 정책: 없는 파일·깨진 JSON → get 은 null, list 는 건너뛴다. 한 파일이
// 깨져도 기능 전체가 죽지 않는다(기존 스토어들의 catch 동작과 동일).

export interface DirStoreConfig {
  /** data/ 아래 디렉터리 이름 (e.g. "quotes", "collection/notes"). */
  dir: string;
  /** 디렉터리 전체를 오버라이드하는 env var (e.g. "QUOTES_DATA_DIR"). 테스트 격리용. */
  envVar?: string;
}

export interface DirStore<T> {
  /** 디렉터리 경로 (지연 해석 — 호출 시점 env 를 읽는다). */
  dir(): string;
  /** 레코드 파일 경로. */
  path(id: string): string;
  /** {id}.json 파싱. 없거나 깨졌으면 null. */
  get(id: string): Promise<T | null>;
  /** 모든 *.json 파싱. 깨진 파일은 건너뛴다. 정렬은 호출처 몫. */
  list(): Promise<T[]>;
  /** mkdir -p 후 tmp 에 쓰고 rename (원자적). */
  put(id: string, value: T): Promise<void>;
  /** 삭제. 지웠으면 true, 없었으면 false. */
  remove(id: string): Promise<boolean>;
}

// id 는 파일명이 된다 — 경로 구분자·".."·숨김/특수 문자를 거부해 디렉터리 탈출
// (path traversal)을 factory 한 곳에서 막는다. 레코드 id 는 전부 UUID·slug 라
// 이 화이트리스트로 충분하다.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSafeId(id: string): boolean {
  return SAFE_ID_RE.test(id) && !id.includes("..");
}

export function dirStore<T>(config: DirStoreConfig): DirStore<T> {
  function resolveDir(): string {
    if (config.envVar) {
      const override = process.env[config.envVar];
      if (override) return override;
    }
    return path.join(process.cwd(), "data", config.dir);
  }

  function filePath(id: string): string {
    if (!isSafeId(id)) throw new Error(`잘못된 레코드 id: ${JSON.stringify(id)}`);
    return path.join(resolveDir(), `${id}.json`);
  }

  async function get(id: string): Promise<T | null> {
    if (!isSafeId(id)) return null;
    try {
      const raw = await fs.readFile(filePath(id), "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  return {
    dir: resolveDir,
    path: filePath,
    get,
    async list(): Promise<T[]> {
      const dir = resolveDir();
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        return []; // 디렉터리 자체가 없음 = 레코드 0개
      }
      const out: T[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        try {
          out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf-8")) as T);
        } catch {
          // 깨진 파일은 건너뛴다 — 한 레코드가 목록 전체를 막지 않게
        }
      }
      return out;
    },
    async put(id: string, value: T): Promise<void> {
      await writeJsonAt(filePath(id), value);
    },
    async remove(id: string): Promise<boolean> {
      if (!isSafeId(id)) return false;
      try {
        await fs.unlink(filePath(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function jsonStore<T>(config: JsonStoreConfig<T>): JsonStore<T> {
  function resolvePath(): string {
    if (config.envVar) {
      const override = process.env[config.envVar];
      if (override) return override;
    }
    const dir =
      (config.dirEnvVar && process.env[config.dirEnvVar]) ||
      path.join(process.cwd(), "data");
    return path.join(dir, config.file);
  }

  return {
    path: resolvePath,
    read: () => readJsonAt(resolvePath(), config.fallback, { strict: config.strict }),
    write: (data: T) =>
      writeJsonAt(resolvePath(), data, { secret: config.secret }),
  };
}
