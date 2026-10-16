#!/bin/bash

# 회의 녹음 토글. 앱의 녹음 버튼이 이 스크립트를 부른다.
# 원격(remote)은 마이크·시스템 소리를 나눠 녹음하고, 대면(inperson)은 마이크만 녹음한다.

set -u
# 녹음 원본은 본인만 읽는다(폴더 700, 파일 600). 녹음 도구도 이 값을 물려받는다.
umask 077

export PATH="$HOME/.seoa-studio/node/bin:/usr/bin:/bin:$PATH"

INGEST_URL="${INGEST_URL:-http://127.0.0.1:3100/api/meetings/ingest}"
REC_DIR="${REC_DIR:-$HOME/Recordings/meetings}"
# 상태는 사용자 전용 폴더에 둔다(/tmp 는 다른 사용자도 쓸 수 있다). 앱(recording.ts)도 같은 경로를 읽는다.
STATE_DIR="${MEETING_RECORD_STATE_DIR:-$HOME/Library/Application Support/SimplyhomeStudio/recording}"
STATE_FILE="${STATE_FILE:-${MEETING_RECORD_STATE:-$STATE_DIR/meeting-record.pid}}"
LOCK_FILE="${STATE_FILE}.flock"
STOP_ERROR_FILE="${STATE_FILE}.stop-error"
# 녹음 최대 길이(초). 넘으면 감시자가 자동으로 멈춘다. 기본 4시간.
MAX_RECORD_SEC="${MEETING_MAX_RECORD_SEC:-14400}"
# 앱 서버 PID. 앱이 넘겨주며, 서버가 꺼지면 감시자가 녹음을 멈춘다.
SERVER_PID="${MEETING_SERVER_PID:-}"
WATCH_INTERVAL="${MEETING_WATCH_INTERVAL:-5}"
PREFERRED_MIC="${PREFERRED_MIC:-}"
MODE="${1:-${MODE:-remote}}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "$0")"
NATIVE_DIR="$SCRIPT_DIR"
# 저장소에 미리 만든 녹음 도구가 있다(scripts/build-capture.sh). 개발 도구 없이 바로 쓴다.
CAPTURE_BIN="${MEETING_CAPTURE_BIN:-$SCRIPT_DIR/../../bin/meeting-capture}"

fail() {
  echo "❌ $1"
  exit 1
}

notify() {
  local title="$1"
  local message="$2"
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"${message//\"/\\\"}\" with title \"${title//\"/\\\"}\"" >/dev/null 2>&1 || true
}

compile_capture() {
  [ -x "$CAPTURE_BIN" ] || fail "녹음 도구가 없습니다: $CAPTURE_BIN (설치를 다시 실행해 주세요)"
}

current_input() {
  command -v SwitchAudioSource >/dev/null 2>&1 || return 0
  SwitchAudioSource -c -t input 2>/dev/null
}

preferred_input() {
  if command -v SwitchAudioSource >/dev/null 2>&1 \
    && SwitchAudioSource -a -t input 2>/dev/null | grep -qxF "$PREFERRED_MIC"; then
    printf '%s' "$PREFERRED_MIC"
    return
  fi
  current_input
}

set_input() {
  command -v SwitchAudioSource >/dev/null 2>&1 || return 1
  SwitchAudioSource -t input -s "$1" >/dev/null 2>&1
}

restore_input() {
  local previous="$1"
  [ -n "$previous" ] || return 0
  [ "$(current_input)" = "$previous" ] || set_input "$previous" || true
}

# PID 가 살아 있고, 그 프로세스가 정말 우리 녹음 도구일 때만 참이다.
# PID 는 재사용되므로 kill -0 만 보면 다른 프로그램을 신호로 끌 수 있다.
is_our_capture() {
  local pid="$1" cmd
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  cmd=$(ps -p "$pid" -o command= 2>/dev/null) || return 1
  case "$cmd" in *"$(basename "$CAPTURE_BIN")"*) return 0 ;; esac
  return 1
}

# 상태 파일에 기록된 녹음이 실제로 돌고 있으면 1(녹음 중), 아니면 상태를 지우고 0.
clear_stale_state() {
  if [ -f "$STATE_FILE" ]; then
    if is_our_capture "$(sed -n '1p' "$STATE_FILE")"; then
      return 1
    fi
    rm -f "$STATE_FILE" "$STOP_ERROR_FILE"
  fi
  return 0
}

# 시작·종료를 한 번에 하나만 하도록 운영체제 잠금(flock)을 잡는다.
# 잠금은 fd 9 에 걸리고, 이 스크립트가 죽으면 운영체제가 풀어 준다(오래된 잠금 회수가 필요 없다).
# macOS 에는 flock(1) 이 없어 기본 perl 로 같은 fd 에 잠금을 건다. 자식 프로세스는 9>&- 로 fd 를 닫고 띄운다.
LOCK_HELD=0
release_lock() {
  [ "$LOCK_HELD" = "1" ] && exec 9>&-
  LOCK_HELD=0
}
acquire_lock() {
  exec 9>>"$LOCK_FILE" || fail "잠금 파일을 열지 못했습니다: $LOCK_FILE"
  if /usr/bin/perl -MFcntl=:flock -e '
    open(my $f, ">&=", 9) or exit 2;
    for (1..40) { exit 0 if flock($f, LOCK_EX | LOCK_NB); select(undef, undef, undef, 0.25) }
    exit 1'; then
    LOCK_HELD=1
    trap release_lock EXIT
    return 0
  fi
  exec 9>&-
  fail "다른 녹음 시작·종료가 진행 중입니다. 잠시 뒤 다시 시도하세요."
}

# 감시자: 녹음 도구가 살아 있는 동안 서버 생존과 최대 길이를 본다.
# 서버가 꺼지거나 시간이 넘으면 이 스크립트의 --stop 으로 정상 종료(파일 보존·업로드 시도)한다.
start_watchdog() {
  local rec_pid="$1" started
  started=$(date +%s)
  (
    # 부모의 잠금 해제 trap 을 물려받지 않는다(남의 잠금을 지우면 안 된다).
    LOCK_HELD=0
    trap - EXIT
    trap '' HUP
    while is_our_capture "$rec_pid"; do
      sleep "$WATCH_INTERVAL"
      reason=""
      if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
        reason="앱 서버가 꺼졌습니다"
      elif [ $(( $(date +%s) - started )) -ge "$MAX_RECORD_SEC" ]; then
        reason="최대 녹음 시간(${MAX_RECORD_SEC}초)을 넘었습니다"
      fi
      if [ -n "$reason" ]; then
        echo "watchdog: $reason"
        notify "회의 녹음 자동 종료" "$reason"
        if [ -f "$SELF" ]; then
          MEETING_STOP_PID="$rec_pid" bash "$SELF" --stop
        fi
        # 스크립트가 지워졌거나(설치 해제) 종료가 실패해도 녹음 도구는 반드시 멈춘다.
        if is_our_capture "$rec_pid"; then
          kill -INT "$rec_pid" 2>/dev/null || true
          for _ in $(seq 1 30); do is_our_capture "$rec_pid" || break; sleep 0.25; done
          is_our_capture "$rec_pid" && kill -TERM "$rec_pid" 2>/dev/null || true
        fi
        exit 0
      fi
    done
  ) </dev/null >>"$SESSION_DIR/watchdog.log" 2>&1 9>&- &
}

if [ "$MODE" = "--doctor" ] || [ "$MODE" = "--mic-check" ]; then
  compile_capture
  echo "input=$(preferred_input)"
  "$CAPTURE_BIN" --doctor
  if curl -sf "${INGEST_URL%/ingest}/recording" >/dev/null 2>&1; then
    echo "dashboard=reachable"
  else
    echo "dashboard=unreachable"
    exit 1
  fi
  exit 0
fi

if [ "$MODE" = "--device-check" ]; then
  shift
  MODE="${1:-remote}"
  compile_capture
  echo "mode=$MODE mic=$(preferred_input) capture=native"
  exit 0
fi

# 의도: 앱은 start/stop 을 명시해 부른다. 동시에 두 번 눌러도 시작이 종료로 뒤집히지 않는다.
# 직접 실행(의도 없음)은 예전처럼 토글이다.
INTENT="${MEETING_RECORD_INTENT:-toggle}"
STOP_ONLY=0
if [ "$MODE" = "--stop" ]; then
  STOP_ONLY=1
  INTENT=stop
else
  [ "$MODE" = "remote" ] || [ "$MODE" = "inperson" ] || fail "모드는 remote 또는 inperson이어야 합니다"
fi

mkdir -p "$(dirname "$STATE_FILE")" || fail "상태 폴더 생성 실패: $(dirname "$STATE_FILE")"
chmod 700 "$(dirname "$STATE_FILE")" 2>/dev/null || true
acquire_lock

if clear_stale_state; then
  if [ "$INTENT" = "stop" ]; then
    echo "진행 중인 녹음이 없습니다."
    exit 0
  fi
  compile_capture
  mkdir -p "$REC_DIR" || fail "녹음 폴더 생성 실패: $REC_DIR"
  chmod 700 "$REC_DIR" 2>/dev/null || true
  timestamp=$(date +%Y-%m-%d_%H%M%S)
  SESSION_DIR="$REC_DIR/meeting_${MODE}_${timestamp}"
  mkdir -p "$SESSION_DIR" || fail "녹음 세션 폴더 생성 실패"
  MIC_FILE="$SESSION_DIR/mic.caf"
  SYSTEM_FILE="$SESSION_DIR/system.caf"
  META_FILE="$SESSION_DIR/meta.json"
  LOG_FILE="$SESSION_DIR/capture.log"

  PREV_INPUT=$(current_input)
  SELECTED_INPUT=$(preferred_input)
  if [ -n "$SELECTED_INPUT" ] && [ "$PREV_INPUT" != "$SELECTED_INPUT" ]; then
    set_input "$SELECTED_INPUT" || true
  fi

  capture_args=(--mode "$MODE" --mic "$MIC_FILE" --meta "$META_FILE")
  if [ "$MODE" = "remote" ]; then
    capture_args+=(--system "$SYSTEM_FILE")
  fi
  "$CAPTURE_BIN" "${capture_args[@]}" >"$LOG_FILE" 2>&1 9>&- &
  REC_PID=$!

  ready=0
  for _ in $(seq 1 20); do
    if ! kill -0 "$REC_PID" 2>/dev/null; then
      restore_input "$PREV_INPUT"
      tail -n 5 "$LOG_FILE" 2>/dev/null
      fail "녹음을 시작하지 못했습니다. 개인정보 보호 설정의 마이크와 시스템 오디오 권한을 확인하세요."
    fi
    if grep -q "capture-ready" "$LOG_FILE" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.25
  done
  if [ "$ready" != "1" ]; then
    kill -TERM "$REC_PID" 2>/dev/null || true
    restore_input "$PREV_INPUT"
    fail "네이티브 캡처 준비 시간이 초과되었습니다"
  fi

  printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
    "$REC_PID" "$MIC_FILE" "$MODE" "$PREV_INPUT" "$SYSTEM_FILE" "$META_FILE" "$SESSION_DIR" \
    > "$STATE_FILE"
  start_watchdog "$REC_PID"
  release_lock
  if [ "$MODE" = "remote" ]; then
    echo "🔴 원격 녹음 시작 — 마이크와 시스템 오디오를 별도 트랙으로 저장합니다."
  else
    echo "🔴 대면 녹음 시작 — 마이크 트랙을 저장합니다."
  fi
  exit 0
fi

if [ "$INTENT" = "start" ]; then
  echo "이미 녹음 중입니다."
  exit 0
fi

REC_PID=$(sed -n '1p' "$STATE_FILE")
MIC_FILE=$(sed -n '2p' "$STATE_FILE")
REC_MODE=$(sed -n '3p' "$STATE_FILE")
PREV_INPUT=$(sed -n '4p' "$STATE_FILE")
SYSTEM_FILE=$(sed -n '5p' "$STATE_FILE")
META_FILE=$(sed -n '6p' "$STATE_FILE")
SESSION_DIR=$(sed -n '7p' "$STATE_FILE")

# 감시자가 부른 종료는 자기가 지켜보던 녹음만 멈춘다(그사이 새 녹음이 시작됐을 수 있다).
if [ -n "${MEETING_STOP_PID:-}" ] && [ "$MEETING_STOP_PID" != "$REC_PID" ]; then
  echo "감시하던 녹음이 이미 끝났습니다."
  exit 0
fi

echo "⏹  녹음 종료 중..."
rm -f "$STOP_ERROR_FILE"
# clear_stale_state 가 방금 우리 녹음 도구임을 확인했다.
kill -INT "$REC_PID" 2>/dev/null || true
for _ in $(seq 1 30); do
  is_our_capture "$REC_PID" || break
  sleep 0.25
done
if is_our_capture "$REC_PID"; then
  kill -TERM "$REC_PID" 2>/dev/null || true
  for _ in $(seq 1 12); do
    is_our_capture "$REC_PID" || break
    sleep 0.25
  done
fi
# 프로세스가 아직 살아 있으면(예: 멈춘 상태) 녹음이 끝났다고 볼 수 없다.
# 상태 파일을 지우거나 변환·업로드를 하지 않고, 녹음 중 상태를 그대로 둔다.
if is_our_capture "$REC_PID"; then
  STOP_MSG="녹음 프로세스가 종료되지 않았습니다. 녹음 중 상태로 남겨 둡니다. 잠시 뒤 다시 종료하세요."
  printf '%s\n' "$STOP_MSG" > "$STOP_ERROR_FILE" 2>/dev/null || true
  notify "회의 녹음 종료 실패" "녹음 프로세스가 아직 살아 있습니다."
  release_lock
  fail "$STOP_MSG"
fi
rm -f "$STATE_FILE" "$STOP_ERROR_FILE"
release_lock
restore_input "$PREV_INPUT"

[ -s "$MIC_FILE" ] || fail "마이크 녹음 파일이 비어 있습니다: $MIC_FILE"
if [ "$REC_MODE" = "remote" ] && [ ! -s "$SYSTEM_FILE" ]; then
  echo "⚠️  시스템 오디오 트랙이 비어 있어 마이크만 업로드합니다."
fi

offsets=$(node -e '
try { const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(`${v.micOffsetMs ?? 0} ${v.systemOffsetMs ?? 0}`); } catch { console.log("0 0"); }' "$META_FILE")

# 받아쓰기 서비스가 확실히 읽는 m4a 로 바꾼다. afconvert 는 macOS 기본 도구다.
to_m4a() {
  local src="$1" dst="${1%.caf}.m4a"
  if afconvert -f m4af -d aac "$src" "$dst" >/dev/null 2>&1 && [ -s "$dst" ]; then
    printf '%s' "$dst"
  else
    printf '%s' "$src"
  fi
}
MIC_UP=$(to_m4a "$MIC_FILE")
SYSTEM_UP=""
[ -s "$SYSTEM_FILE" ] && SYSTEM_UP=$(to_m4a "$SYSTEM_FILE")
mime_of() { case "$1" in *.m4a) printf 'audio/mp4' ;; *) printf 'audio/x-caf' ;; esac; }
MIC_OFFSET=$(printf '%s' "$offsets" | awk '{print $1}')
SYSTEM_OFFSET=$(printf '%s' "$offsets" | awk '{print $2}')

curl_args=(
  -sS -X POST
  -F "mic=@${MIC_UP};type=$(mime_of "$MIC_UP")"
  -F "micOffsetMs=${MIC_OFFSET}"
  -F "mode=${REC_MODE}"
)
if [ "$REC_MODE" = "remote" ] && [ -n "$SYSTEM_UP" ]; then
  curl_args+=(
    -F "system=@${SYSTEM_UP};type=$(mime_of "$SYSTEM_UP")"
    -F "systemOffsetMs=${SYSTEM_OFFSET}"
  )
fi

echo "⬆️  분리 트랙 업로드 중..."
RESP=$(curl "${curl_args[@]}" "$INGEST_URL" 2>"$SESSION_DIR/upload.log")
CURL_RC=$?
if [ "$CURL_RC" -ne 0 ] || [ -z "$RESP" ]; then
  notify "회의 녹음 업로드 실패" "녹음 파일은 안전하게 보존했습니다."
  echo "❌ 업로드 실패. 녹음 파일은 보존됩니다: $SESSION_DIR"
  exit 1
fi

URL_PATH=$(printf '%s' "$RESP" | node -e '
let t = ""; process.stdin.on("data", (d) => (t += d)).on("end", () => {
  try { console.log(JSON.parse(t).url ?? ""); } catch { console.log(""); } });' 2>/dev/null)
if [ -z "$URL_PATH" ]; then
  notify "회의 녹음 업로드 확인 필요" "서버 응답에서 회의록 주소를 읽지 못했습니다."
  fail "업로드 응답에서 회의록 URL을 읽지 못했습니다: $RESP"
fi

ORIGIN=$(printf '%s' "$INGEST_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
MEETING_URL="${ORIGIN}${URL_PATH}"
notify "회의 녹음 업로드 완료" "전사 대기열에 추가했습니다."
echo "✅ 업로드 완료 → $MEETING_URL"
open "$MEETING_URL"
