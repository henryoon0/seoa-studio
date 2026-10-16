import { NextRequest, NextResponse } from "next/server";
import { tagMeetingPeople } from "@/lib/meetings/tag-people";
import { isValidPersonName } from "@/lib/meetings/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { people?: unknown };
    const people = Array.isArray(body.people)
      ? body.people.map((p) => String(p).trim()).filter(Boolean)
      : [];

    const invalid = people.filter((p) => !isValidPersonName(p));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `유효하지 않은 이름: ${invalid.join(", ")}` },
        { status: 400 }
      );
    }

    const meeting = await tagMeetingPeople(id, people);
    if (!meeting) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ meeting });
  } catch (e) {
    const message = e instanceof Error ? e.message : "태깅 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
