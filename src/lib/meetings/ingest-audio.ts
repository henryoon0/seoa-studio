import {
  probeAudioDurationSec,
  saveMeetingAudio,
  saveMeetingAudioTrack,
} from "./audio-store";
import { createMeeting, getMeeting, updateMeeting } from "./store";
import type {
  AudioInput,
  Meeting,
  MeetingAudioTracks,
} from "./types";

export interface ProcessMeta {
  readonly date?: string;
  readonly mode?: "remote" | "inperson";
  readonly source?: "voice-memo";
  readonly voiceIngestKey?: string;
}

export interface NativeMeetingTracksInput {
  readonly mic?: AudioInput;
  readonly system?: AudioInput;
  readonly startOffsetMs?: {
    readonly mic?: number;
    readonly system?: number;
  };
}

async function requireStoredMeeting(id: string): Promise<Meeting> {
  const meeting = await getMeeting(id);
  if (!meeting) throw new Error("저장한 회의를 다시 읽지 못했습니다");
  return meeting;
}

export async function persistMeetingAudio(
  audio: AudioInput,
  meta: ProcessMeta
): Promise<Meeting> {
  const meeting = await createMeeting(meta);
  const audioFile = await saveMeetingAudio(meeting.id, audio);
  const durationSec = await probeAudioDurationSec(audioFile);
  await updateMeeting(meeting.id, {
    audioFile,
    ...(durationSec ? { durationSec } : {}),
  });
  return requireStoredMeeting(meeting.id);
}

export async function persistMeetingTracks(
  input: NativeMeetingTracksInput,
  meta: ProcessMeta
): Promise<Meeting> {
  const meeting = await createMeeting(meta);
  const tracks: MeetingAudioTracks = {
    ...(input.mic
      ? {
          mic: await saveMeetingAudioTrack(
            meeting.id,
            "mic",
            input.mic,
            input.startOffsetMs?.mic ?? 0
          ),
        }
      : {}),
    ...(input.system
      ? {
          system: await saveMeetingAudioTrack(
            meeting.id,
            "system",
            input.system,
            input.startOffsetMs?.system ?? 0
          ),
        }
      : {}),
  };
  const durations = await Promise.all(
    [tracks.mic?.file, tracks.system?.file]
      .filter((file): file is string => Boolean(file))
      .map(probeAudioDurationSec)
  );
  const durationSec = Math.max(
    0,
    ...durations.filter((value): value is number => value !== undefined)
  );
  await updateMeeting(meeting.id, {
    audioTracks: tracks,
    ...(durationSec > 0 ? { durationSec } : {}),
  });
  return requireStoredMeeting(meeting.id);
}
