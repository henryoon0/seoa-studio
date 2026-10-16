import { taggedMeetingTitle } from "./tags";
import {
  applyAliasesToTranscript,
  listNameAliases,
} from "./name-aliases";
import { parseAnalysis } from "./analysis";
import { buildContextText } from "./context-sources";
import { attachAnalysisEvidence } from "./evidence";
import { refineTasks } from "./task-extract";
import {
  setStatus,
  updateMeeting,
  updateMeetingIfTranscriptVersion,
  transcriptVersionOf,
  getMeeting,
  mutateMeeting,
} from "./store";
import {
  deleteMeetingAudio,
  deleteMeetingAudioTracks,
  readMeetingAudio,
} from "./audio-store";
import { meetingAsrQueue } from "./asr-queue";
import { loadMeetingGlossary } from "./glossary";
import { notifyMeetingResult } from "./notification";
import {
  persistMeetingAudio,
  persistMeetingTracks,
  type NativeMeetingTracksInput,
  type ProcessMeta,
} from "./ingest-audio";
import {
  canonicalizeLegacyTranscript,
  transcribeNativeTracks,
} from "./track-transcription";
import { isRunning, runPhase } from "@/lib/jobs/run";
import type {
  AudioInput,
  Meeting,
  MeetingAi,
  TranscriptEngine,
} from "./types";

export type { NativeMeetingTracksInput, ProcessMeta } from "./ingest-audio";

export interface ProcessDeps {
  /** ingest 는 전사/분석만 사용한다(편지 생성은 별도 라우트). */
  ai: Pick<MeetingAi, "transcribeAudio" | "analyzeMeeting" | "extractTasks">;
}

/**
 * 비동기 ingest — 업로드 즉시 레코드를 만들고 오디오를 영속화한 뒤 202 로 돌아간다.
 * 전사·분석은 백그라운드(runPhase). 예전 동기 방식은 50분 회의에 curl 이 ~30분
 * 블록됐고, 서버 재시작이 처리를 영구히 죽였다(오디오 미영속 → 재개 불가).
 *
 * fire-and-forget 3종 세트:
 *   ① 고아 재개 — status recorded/transcribed 가 active. 상세 GET 폴링·sweep 이
 *      maybeResumeProcessing 으로 다시 띄운다(재료는 영속화된 오디오).
 *   ② 부분 저장 — 단계마다 상태 전진(recorded → transcribed → ready).
 *   ③ 하드 타임아웃 — whisper(WHISPER_TIMEOUT_MS)·분석 CLI 자체 타임아웃.
 */
export async function ingestMeetingAudio(
  audio: AudioInput,
  deps: ProcessDeps,
  meta: ProcessMeta = {}
): Promise<Meeting> {
  const meeting = await persistMeetingAudio(audio, meta);
  startMeetingProcessing(meeting.id, deps);
  return meeting;
}

export async function ingestMeetingTracks(
  input: NativeMeetingTracksInput,
  deps: ProcessDeps,
  meta: ProcessMeta = {}
): Promise<Meeting> {
  const meeting = await persistMeetingTracks(input, meta);
  startMeetingProcessing(meeting.id, deps);
  return meeting;
}

function processKey(id: string): string {
  return `meeting:process:${id}`;
}

/** 이 프로세스에서 해당 회의의 전사·분석이 실제로 도는 중인지. */
export function isProcessingMeeting(id: string): boolean {
  return isRunning(processKey(id));
}

/**
 * 전사·분석 파이프라인 본체(재개 가능). 어떤 단계에서 실패해도 레코드를 보존한 채
 * status "failed" + error 로 남는다(절대 recorded/transcribed 에 갇히지 않는다).
 */
export async function runMeetingProcessing(
  meetingId: string,
  deps: ProcessDeps
): Promise<void> {
  let finishedVersion: number | undefined;
  await runPhase({
    key: processKey(meetingId),
    async begin() {
      const meeting = await getMeeting(meetingId);
      if (!meeting) return null;
      if (meeting.status !== "recorded" && meeting.status !== "transcribed") {
        return null; // ready/failed — 돌 게 없다
      }
      return { meeting };
    },
    async work({ meeting }: { meeting: Meeting }) {
      let transcript = meeting.transcript;
      const needTranscribe =
        meeting.retryTranscriptionRequested === true ||
        !transcript ||
        transcript.segments.length === 0;
      if (needTranscribe) {
        const hasNativeTracks = Boolean(
          meeting.audioTracks?.mic || meeting.audioTracks?.system
        );
        const audio = hasNativeTracks
          ? null
          : await readMeetingAudio(meeting.audioFile);
        if (!hasNativeTracks && !audio) {
          throw new Error(
            "오디오 사본이 없어 전사를 재개할 수 없습니다 (scripts/recover-meeting.ts 로 원본에서 복구)"
          );
        }
        // 이름 별칭 — "이름 일괄 변경"으로 학습된 오전사 이름을 전사 직후 교정.
        // 분석은 교정된 plain 을 받으므로 결과물 전체가 올바른 이름으로 나온다.
        // 용어집(data/meetings/glossary.md)의 잘못 들린 표기도 별칭과 같은 치환을 탄다.
        // 용어집을 뒤에 둬서 henry가 손으로 고친 별칭이 먼저 적용되게 한다.
        const glossary = await loadMeetingGlossary();
        const aliases = [...(await listNameAliases()), ...glossary.corrections];
        const keyterms = [...meetingKeyterms(meeting, aliases), ...glossary.terms];
        const queuePosition =
          meetingAsrQueue.snapshot().queuedMeetingIds.length + 1;
        await updateMeeting(meetingId, {
          processing: { stage: "queued", queuePosition },
        });
        transcript = await meetingAsrQueue.run(meetingId, async () => {
          await updateMeeting(meetingId, {
            processing: { stage: "transcribing" },
          });
          if (hasNativeTracks) {
            return transcribeNativeTracks(meeting, {
              ai: deps.ai,
              keyterms,
              async onPartial(update) {
                await updateMeeting(meetingId, {
                  transcript: applyAliasesToTranscript(
                    update.transcript,
                    aliases
                  ),
                  transcribeProgress: update.progress,
                });
              },
            });
          }
          if (!audio) throw new Error("전사할 오디오 사본이 없습니다");
          let engine: TranscriptEngine | undefined;
          const raw = await deps.ai.transcribeAudio(audio, {
            channelSeparated: meeting.mode === "remote",
            keyterms,
            maxSpeakers:
              meeting.people.length > 0 ? meeting.people.length + 1 : undefined,
            durationSec: meeting.durationSec,
            onEngine(used) {
              engine = used;
            },
            async onEngineStart(used) {
              await updateMeeting(meetingId, {
                processing: { stage: "transcribing", engine: used.engine },
              });
            },
            async onPartial(accJson, progress) {
              await updateMeeting(meetingId, {
                transcript: applyAliasesToTranscript(
                  canonicalizeLegacyTranscript(accJson),
                  aliases
                ),
                transcribeProgress: progress,
              });
            },
          });
          return canonicalizeLegacyTranscript(raw, engine);
        });
        transcript = applyAliasesToTranscript(transcript, aliases);
        await updateMeeting(meetingId, {
          transcript,
          transcribeProgress: undefined,
          retryTranscriptionRequested: undefined,
        });
        await setStatus(meetingId, "transcribed");
      }

      if (!transcript) {
        throw new Error("분석할 전사가 없습니다");
      }

      // 분석은 수 분 걸린다. 그동안 사용자가 발화를 지우면 전사본 버전이 오른다.
      // 시작 때의 버전과 저장 때의 버전이 다르면 결과를 버리고 현재 전사본으로 다시 돈다.
      // (지운 직후의 재분석 요청은 이 잡이 도는 동안 무시되므로, 다시 도는 일은 이 루프가 한다.)
      for (;;) {
        const current = await getMeeting(meetingId);
        if (!current) return;
        if (current.status !== "recorded" && current.status !== "transcribed") {
          return; // 사이에 끝났다(전부 지워 ready 가 된 경우 등) — 돌 게 없다
        }
        const analyzing = current.transcript;
        if (!analyzing || analyzing.segments.length === 0) return;
        const version = transcriptVersionOf(current);

        await updateMeeting(meetingId, {
          processing: { stage: "analyzing" },
        });
        // 참고 자료는 전사 중에도 추가될 수 있으니 분석 직전에 다시 읽는다.
        const contextText = buildContextText(current.contextSources);
        const rawAnalysis = await deps.ai.analyzeMeeting(analyzing.plain, {
          includeAutomationLeads: true,
          ...(contextText ? { contextText } : {}),
        });
        const parsed = parseAnalysis(rawAnalysis);
        const analysis = attachAnalysisEvidence(
          deps.ai.extractTasks
            ? await refineTasks(
                parsed,
                analyzing,
                deps.ai.extractTasks.bind(deps.ai)
              )
            : parsed,
          analyzing
        );
        const title = taggedMeetingTitle(
          (await getMeeting(meetingId))?.title,
          analysis
        );
        const saved = await updateMeetingIfTranscriptVersion(meetingId, version, {
          analysis,
          processing: undefined,
          ...(title ? { title } : {}),
        });
        if (saved === "missing") return;
        if (saved === "stale") continue;

        // 성공 — 오디오 사본 정리(원본은 ~/Recordings 에 남는다).
        // ⚠ "ready" 보다 **먼저** 지운다. 반대 순서면 ready 를 본 화면·폴링이 아직
        //   남아 있는 사본을 보는 반쪽 상태가 생긴다(테스트가 실제로 여기서 깨졌다).
        //   정리 실패는 회의를 실패로 만들지 않는다 — 분석은 이미 끝났고, 남은 사본은
        //   다음 정리나 수동 삭제로 회수하면 되는 부산물이다.
        if (analyzing.quality?.completeness !== "partial") {
          try {
            await Promise.all([
              deleteMeetingAudio(meeting.audioFile),
              deleteMeetingAudioTracks(meeting.audioTracks),
            ]);
            await updateMeeting(meetingId, {
              audioFile: undefined,
              audioTracks: undefined,
            });
          } catch (e) {
            console.error("[meetings] 오디오 사본 정리 실패", meetingId, e);
          }
        }

        // ready 도 같은 버전 검사 아래에서 쓴다. 분석 저장과 ready 사이에 지움이
        // 끼면(analysis 가 비워지고 status 가 transcribed 로 돌아간 상태) 다시 돈다.
        const ready = await updateMeetingIfTranscriptVersion(meetingId, version, {
          status: "ready",
        });
        if (ready === "missing") return;
        if (ready === "stale") continue;
        finishedVersion = version;
        notifyMeetingResult("ready", meetingId);
        return;
      }
    },
    async fail(message) {
      await updateMeeting(meetingId, { processing: undefined });
      await setStatus(meetingId, "failed", message);
      notifyMeetingResult("failed", meetingId, message);
    },
  });

  // ready 를 쓴 직후 ~ 잡 키가 풀리기 전 사이에 발화 삭제가 끼면, 그 삭제의 재분석
  // 요청은 "이미 도는 중"으로 무시된다. 키가 풀린 지금 한 번 더 확인해서 이어 돈다.
  if (finishedVersion !== undefined) {
    const after = await getMeeting(meetingId);
    if (
      after &&
      transcriptVersionOf(after) !== finishedVersion &&
      (after.status === "recorded" || after.status === "transcribed")
    ) {
      startMeetingProcessing(meetingId, deps);
    }
  }
}

/** fire-and-forget 진입점. 에러는 status failed 로만 남는다. */
export function startMeetingProcessing(
  meetingId: string,
  deps: ProcessDeps
): void {
  void runMeetingProcessing(meetingId, deps).catch((e) => {
    console.error("[meetings] runMeetingProcessing crashed", meetingId, e);
  });
}

/** 폴링 GET·sweep 훅 — recorded/transcribed 고아 자동 재개. */
export function maybeResumeProcessing(
  meeting: Meeting,
  deps: ProcessDeps
): void {
  if (meeting.status !== "recorded" && meeting.status !== "transcribed") return;
  if (isProcessingMeeting(meeting.id)) return;
  startMeetingProcessing(meeting.id, deps);
}

export async function requestMeetingTranscriptionRetry(
  meetingId: string,
  deps: ProcessDeps
): Promise<Meeting> {
  const meeting = await getMeeting(meetingId);
  if (!meeting?.audioTracks && !meeting?.audioFile) {
    throw new Error("재시도할 오디오 사본이 없습니다");
  }
  const updated = await updateMeeting(meetingId, {
    status: "recorded",
    error: undefined,
    retryTranscriptionRequested: true,
    processing: { stage: "queued" },
  });
  if (!updated) throw new Error("재시도할 회의를 찾을 수 없습니다");
  startMeetingProcessing(meetingId, deps);
  return updated;
}

export type RetryFailedOutcome =
  | "restarted"
  | "not-failed"
  | "no-audio"
  | "missing";

/**
 * failed 회의를 저장된 오디오·전사에서 다시 돌린다(멱등).
 * 회의 줄(mutateMeeting) 안에서 status 를 검사하고 바꾸므로, 두 번 눌러도 한 번만 되돌리고
 * 이미 돌거나 끝난 회의는 건드리지 않는다. 시작은 기존 runPhase 키가 한 번만 허용한다.
 *  - 완성된 전사본이 있으면(진행률 없음) transcribed → 분석부터 이어 간다.
 *  - 전사가 없거나 전사 도중 끊긴 부분본(transcribeProgress 남음)이면 recorded + 재전사.
 */
export async function retryFailedMeeting(
  meetingId: string,
  deps: ProcessDeps
): Promise<{ outcome: RetryFailedOutcome; meeting: Meeting | null }> {
  const res = await mutateMeeting<RetryFailedOutcome>(meetingId, async (m) => {
    if (m.status !== "failed") return { result: "not-failed" };
    if (!m.audioTracks && !m.audioFile && !(m.transcript?.segments.length)) {
      return { result: "no-audio" };
    }
    const complete =
      (m.transcript?.segments.length ?? 0) > 0 && !m.transcribeProgress;
    if (!complete && !m.audioTracks && !m.audioFile) {
      return { result: "no-audio" };
    }
    return {
      result: "restarted",
      patch: {
        status: complete ? "transcribed" : "recorded",
        error: undefined,
        retryTranscriptionRequested: complete ? undefined : true,
        transcribeProgress: undefined,
        processing: complete ? undefined : { stage: "queued" },
      },
    };
  });
  if (!res) return { outcome: "missing", meeting: null };
  if (res.result === "restarted") startMeetingProcessing(meetingId, deps);
  return { outcome: res.result, meeting: res.meeting };
}

/**
 * 동기 처리(테스트·스크립트용 시임) — 업로드부터 완료까지 한 번에 기다린다.
 * 라우트는 ingestMeetingAudio(비동기)를 쓴다.
 */
export async function processMeeting(
  audio: AudioInput,
  deps: ProcessDeps,
  meta: ProcessMeta = {},
  opts: { timeoutMs?: number } = {}
): Promise<Meeting> {
  const meeting = await ingestMeetingAudio(audio, deps, meta);
  return processMeetingUntilSettled(meeting.id, opts.timeoutMs);
}

export async function processMeetingUntilSettled(
  meetingId: string,
  timeoutMs = 90 * 60 * 1000
): Promise<Meeting> {
  // ingest 가 이미 백그라운드로 띄웠다 — 같은 키의 runPhase 는 중복 실행되지 않으니
  // 여기서는 완료를 폴링으로 기다린다.
  //
  // ⚠ terminal status 만 보고 빠져나오면 안 된다. 잡 가드는 work() 가 완전히 끝날
  //   때까지 키를 쥐고 있어서, 그 틈에 건 재시도(requestMeetingTranscriptionRetry)가
  //   "이미 도는 중"으로 조용히 무시되고 회의가 recorded 에 갇힌다. 상태가 끝났고
  //   실제로 도는 것도 없을 때 비로소 정착으로 본다.
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const cur = await getMeeting(meetingId);
    if (!cur) throw new Error("회의 레코드가 사라졌습니다");
    const settled = cur.status === "ready" || cur.status === "failed";
    if (settled && !isProcessingMeeting(meetingId)) {
      // 뒷정리(오디오 사본 삭제)까지 반영된 최신 레코드를 돌려준다.
      return (await getMeeting(meetingId)) ?? cur;
    }
    if (Date.now() > deadline) return cur;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * 전사 엔진에 줄 고유명사 힌트: 참석자, 별칭의 올바른 이름, MEETINGS_KEYTERMS
 * (쉼표 구분, 회사·제품명). 엔진이 상한·길이를 자르므로 여기선 모으기만 한다.
 */
export function meetingKeyterms(
  meeting: Pick<Meeting, "people">,
  aliases: readonly { to: string }[]
): string[] {
  const extra = (process.env.MEETINGS_KEYTERMS ?? "")
    .split(",")
    .map((term) => term.trim());
  return [...meeting.people, ...aliases.map((alias) => alias.to), ...extra].filter(
    Boolean
  );
}
