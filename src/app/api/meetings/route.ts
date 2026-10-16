import { NextResponse } from "next/server";
import {
  listMeetingHomeSummaries,
  listMeetingSummaries,
} from "@/lib/meetings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "home") {
      const limit = Number(url.searchParams.get("limit"));
      const items = await listMeetingHomeSummaries(
        Number.isInteger(limit) && limit > 0 && limit <= 20 ? limit : 3
      );
      return NextResponse.json({ items });
    }
    const items = await listMeetingSummaries();
    return NextResponse.json({ items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "조회 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
