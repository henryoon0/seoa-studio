import { NextResponse, type NextRequest } from "next/server";

// 로컬 전용 앱이라도 henry가 연 아무 웹페이지가 localhost로 요청을 던질 수 있다(CSRF).
// 공격자 도메인을 127.0.0.1로 바꿔 치는 DNS 리바인딩이면 Host와 Origin이 둘 다
// evil.com으로 같아지므로, "둘이 같다"만으로는 부족하다. 주소 이름 자체를 허용 목록으로 본다.

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

function allowedHostnames(): Set<string> {
  const extra = (process.env.DASHBOARD_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOCAL_HOSTNAMES, ...extra]);
}

/** "host:port" 또는 URL을 허용 목록 기준으로 읽는다. 허용 밖이거나 못 읽으면 null. */
function allowedHost(raw: string | null, isUrl: boolean): string | null {
  if (!raw) return null;
  try {
    const url = new URL(isUrl ? raw : `http://${raw}`);
    return allowedHostnames().has(url.hostname.toLowerCase()) ? url.host : null;
  } catch {
    return null; // "null" origin(샌드박스 iframe 등)도 여기로 온다
  }
}

const forbidden = () =>
  NextResponse.json({ error: "대시보드 화면에서 보낸 요청만 받습니다." }, { status: 403 });

/** 읽기용: Host가 허용 목록 밖이면 403. 리바인딩으로 할 일을 읽어 가는 것을 막는다. */
export function rejectForeignHost(req: NextRequest): NextResponse | null {
  return allowedHost(req.headers.get("host"), false) ? null : forbidden();
}

/** 쓰기용: 막아야 하면 응답을, 통과면 null을 돌려준다. */
export function rejectCrossSiteWrite(req: NextRequest): NextResponse | null {
  const host = allowedHost(req.headers.get("host"), false);
  const source = allowedHost(req.headers.get("origin") ?? req.headers.get("referer"), true);
  if (!host || source !== host) return forbidden();
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type)) {
    return NextResponse.json({ error: "JSON 요청만 받습니다." }, { status: 415 });
  }
  return null;
}
