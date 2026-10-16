import { NextRequest, NextResponse } from "next/server";
import {
  ingestMeetingAudio,
  ingestMeetingTracks,
} from "@/lib/meetings/ingest";
import { localAi } from "@/lib/meetings/local-ai";
import type { AudioInput } from "@/lib/meetings/types";
import { MAX_UPLOAD_BYTES } from "@/lib/meetings/upload-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 처리(전사·분석)는 백그라운드다 — 여기선 대용량 업로드 수령만 오래 걸릴 수 있다.
export const maxDuration = 600;

async function audioInput(file: File): Promise<AudioInput> {
  return {
    data: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type || "audio/x-caf",
  };
}

function offsetMs(form: FormData, key: "micOffsetMs" | "systemOffsetMs"): number {
  const value = Number.parseInt(String(form.get(key) ?? "0"), 10);
  return Number.isFinite(value) ? value : 0;
}

export async function POST(req: NextRequest) {
  // 한도를 넘는 본문은 proxy 단계에서 잘리므로, 깨진 파일을 받기 전에 분명히 거절한다.
  const length = Number(req.headers.get("content-length") ?? "0");
  if (!(length <= MAX_UPLOAD_BYTES)) {
    return NextResponse.json(
      {
        error: `녹음 파일이 너무 큽니다. 한 번에 ${MAX_UPLOAD_BYTES / 1024 ** 3}GB 까지 올릴 수 있습니다.`,
      },
      { status: 413 }
    );
  }
  try {
    const form = await req.formData();
    const file = form.get("audio");
    const mic = form.get("mic");
    const system = form.get("system");
    const hasLegacyAudio = file instanceof File;
    const hasNativeTracks = mic instanceof File || system instanceof File;
    if (!hasLegacyAudio && !hasNativeTracks) {
      return NextResponse.json(
        { error: "audio 또는 mic/system 파일이 필요합니다" },
        { status: 400 }
      );
    }

    const modeRaw = String(form.get("mode") ?? "");
    const mode = modeRaw === "inperson" ? "inperson" : "remote";
    const dateRaw = String(form.get("date") ?? "").trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined;

    // 오디오 영속화 + 백그라운드 처리 시작 후 즉시 반환.
    // 상세 페이지가 상태를 폴링하고, 서버가 죽어도 sweep 이 사본에서 재개한다.
    let meeting;
    if (hasNativeTracks) {
      meeting = await ingestMeetingTracks(
          {
            ...(mic instanceof File ? { mic: await audioInput(mic) } : {}),
            ...(system instanceof File
              ? { system: await audioInput(system) }
              : {}),
            startOffsetMs: {
              mic: offsetMs(form, "micOffsetMs"),
              system: offsetMs(form, "systemOffsetMs"),
            },
          },
          { ai: localAi },
          { mode, date }
        );
    } else if (file instanceof File) {
      meeting = await ingestMeetingAudio(
        await audioInput(file),
        { ai: localAi },
        { mode, date }
      );
    } else {
      return NextResponse.json({ error: "audio 파일이 필요합니다" }, { status: 400 });
    }

    return NextResponse.json(
      { id: meeting.id, url: `/meetings/${meeting.id}`, status: meeting.status },
      { status: 202 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "처리 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
