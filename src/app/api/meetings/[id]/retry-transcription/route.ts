import { NextResponse } from "next/server";
import {
  requestMeetingTranscriptionRetry,
} from "@/lib/meetings/ingest";
import { localAi } from "@/lib/meetings/local-ai";

type RetryContext = {
  readonly params: Promise<{ readonly id: string }>;
};

export async function POST(
  _request: Request,
  context: RetryContext
): Promise<Response> {
  try {
    const { id } = await context.params;
    const meeting = await requestMeetingTranscriptionRetry(id, {
      ai: localAi,
    });
    return NextResponse.json(
      { id: meeting.id, status: meeting.status },
      { status: 202 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "전사 재시도를 시작하지 못했습니다",
      },
      { status: 400 }
    );
  }
}
