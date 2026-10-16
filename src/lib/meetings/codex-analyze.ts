import { execCodex } from "../codex-exec";
import { runClaudeCLI } from "../ai/claude-cli";
import { buildAnalyzePrompt } from "./prompts";
import type { MeetingAnalysisOptions } from "./types";

// 회의 *분석* Transport: 공용 codex-exec 위의 얇은 래퍼(자막 번역과 같은 패턴).
// codex 실행·타임아웃·에러 분류는 ../codex-exec 한 곳에 있다.
// codex 불가(미설치·한도·인증)면 호출부(local-ai)가 Claude CLI 로 폴백한다.

// 공개 API 유지: local-ai 가 ./codex-analyze 에서 그대로 가져간다.
export { CodexError, isCodexUnavailable } from "../codex-exec";

const MEETINGS_TIMEOUT_MS = 8 * 60 * 1000;
const MEETINGS_TIMEOUT_MAX_MS = 20 * 60 * 1000;

/**
 * 전사 길이 비례 타임아웃 — 기본 8분 + 30k자 초과분 10k자당 1분, 상한 20분.
 * 고정 8분은 2시간+ 회의(실측 ~500자/분 → 60k자+)에서 분석을 중간에 끊었다.
 */
export function analyzeTimeoutMs(transcriptChars: number): number {
  const extra = Math.max(0, transcriptChars - 30_000);
  return Math.min(
    MEETINGS_TIMEOUT_MAX_MS,
    MEETINGS_TIMEOUT_MS + Math.ceil(extra / 10_000) * 60_000
  );
}

interface AnalyzeTransportOptions extends MeetingAnalysisOptions {
  readonly timeoutMs?: number;
}

/**
 * 전사 plain 을 codex 로 분석해 분석 JSON 문자열을 반환한다(parseAnalysis 가 소비).
 */
export async function analyzeMeetingViaCodex(
  plainTranscript: string,
  opts: AnalyzeTransportOptions = {}
): Promise<string> {
  const prompt = buildAnalyzePrompt(plainTranscript, opts);
  return execCodex(prompt, {
    bin: process.env.MEETINGS_CODEX_BIN || process.env.SUBTITLE_CODEX_BIN || "codex",
    model: process.env.MEETINGS_CODEX_MODEL, // 미설정이면 codex 기본 모델.
    tmpPrefix: "meet-codex-",
    timeoutMs: opts.timeoutMs ?? analyzeTimeoutMs(plainTranscript.length),
  });
}

export async function analyzeMeetingViaClaude(
  plainTranscript: string,
  opts: AnalyzeTransportOptions = {}
): Promise<string> {
  return runClaudeCLI(buildAnalyzePrompt(plainTranscript, opts), {
    model: process.env.MEETINGS_CLAUDE_ANALYZE_MODEL || "sonnet",
    timeoutMs: opts.timeoutMs ?? analyzeTimeoutMs(plainTranscript.length),
  });
}
