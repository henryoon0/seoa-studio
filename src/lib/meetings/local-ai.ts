import {
  elevenLabsConfigured,
  elevenLabsHasCredits,
  elevenLabsModel,
  transcribeWithElevenLabs,
} from "./elevenlabs-asr";
import { analyzeMeetingViaClaude } from "./codex-analyze";
import { runClaudeCLI } from "../ai/claude-cli";
import { TASK_CHUNK_TIMEOUT_MS } from "./task-extract";
import type { AudioInput, MeetingAi } from "./types";

type TranscribeOpts = Parameters<MeetingAi["transcribeAudio"]>[1];

/**
 * ElevenLabs 키가 있으면 먼저 쓴다(한국어·화자 분리). 실패하면 null → whisper.
 * MEETINGS_ASR=local 이면 외부 전송 없이 whisper 만 쓴다.
 */
async function tryElevenLabs(
  audio: AudioInput,
  opts: TranscribeOpts
): Promise<string | null> {
  if (!(await elevenLabsUsable(opts?.durationSec))) return null;
  await opts?.onEngineStart?.({ engine: "elevenlabs", model: elevenLabsModel() });
  try {
    const raw = await transcribeWithElevenLabs(audio, elevenLabsOptions(opts));
    opts?.onEngine?.({ engine: "elevenlabs", model: elevenLabsModel() });
    return raw;
  } catch (e) {
    console.warn(
      "[meetings] ElevenLabs 전사 실패:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

async function elevenLabsUsable(durationSec: number | undefined): Promise<boolean> {
  if (!elevenLabsConfigured()) return false;
  if (await elevenLabsHasCredits(durationSec)) return true;
  console.warn("[meetings] ElevenLabs 크레딧 부족");
  return false;
}

function elevenLabsOptions(opts: TranscribeOpts) {
  return {
    channelSeparated: opts?.channelSeparated === true,
    keyterms: opts?.keyterms,
    maxSpeakers: opts?.maxSpeakers,
  };
}

export const localAi: Pick<MeetingAi, "transcribeAudio" | "analyzeMeeting"> & { extractTasks(prompt: string): Promise<string> } = {
  async transcribeAudio(
    audio: AudioInput,
    opts?: Parameters<MeetingAi["transcribeAudio"]>[1]
  ) {
    const viaElevenLabs = await tryElevenLabs(audio, opts);
    if (viaElevenLabs !== null) return viaElevenLabs;
    // 서아님 스튜디오는 whisper 를 깔지 않는다. ElevenLabs 가 안 되면 이유를 보여 준다.
    throw new Error(
      elevenLabsConfigured()
        ? "ElevenLabs 받아쓰기에 실패했어요. 설정 화면에서 키와 남은 크레딧을 확인해 주세요."
        : "ElevenLabs 키가 없어요. 설정 화면에서 ElevenLabs API 키를 넣어 주세요."
    );
  },

  async analyzeMeeting(
    plainTranscript: string,
    opts?: Parameters<MeetingAi["analyzeMeeting"]>[1]
  ) {
    return opts
      ? analyzeMeetingViaClaude(plainTranscript, opts)
      : analyzeMeetingViaClaude(plainTranscript);
  },

  async extractTasks(prompt: string) {
    return runClaudeCLI(prompt, {
      model: process.env.MEETINGS_CLAUDE_ANALYZE_MODEL || "sonnet",
      timeoutMs: TASK_CHUNK_TIMEOUT_MS,
    });
  },
};
