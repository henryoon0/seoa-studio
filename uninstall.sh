#!/usr/bin/env bash
# 심플리홈 스튜디오 지우기. 설치가 만든 것만 지운다. Claude 는 남긴다.
# 회의·답글 기록(data/)은 바탕화면에 백업한 뒤 지운다.
set -euo pipefail
APP_DIR="${SEOA_APP_DIR:-$HOME/SimplyhomeStudio}"
TOOLS_DIR="${SEOA_TOOLS_DIR:-$HOME/.seoa-studio}"
LAUNCHER="${SEOA_LAUNCHER:-$HOME/Desktop/심플리홈 스튜디오.command}"
GUARD="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/scripts/install-guard.sh"
if [ -f "$GUARD" ]; then
  . "$GUARD"
elif [ -f "$APP_DIR/scripts/install-guard.sh" ] && [ ! -L "$APP_DIR" ]; then
  . "$APP_DIR/scripts/install-guard.sh"
else
  echo "안전 검사 파일이 없어 지우지 않았어요."; exit 1
fi
PORT="${SEOA_PORT:-3100}"
REC_STATE="${MEETING_RECORD_STATE:-$HOME/Library/Application Support/SimplyhomeStudio/recording/meeting-record.pid}"
REC_SCRIPT="$APP_DIR/scripts/recording/meeting-record.sh"

# 녹음 중이면 먼저 정상 종료한다(파일 보존·업로드 시도). 녹음 도구가 남으면 지우지 않는다.
stop_recording() {
  local pid cmd
  [ -f "$REC_STATE" ] || return 0
  pid="$(sed -n '1p' "$REC_STATE")"
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  cmd="$(ps -p "$pid" -o command= 2>/dev/null)" || return 0
  case "$cmd" in *meeting-capture*) ;; *) return 0 ;; esac
  echo "진행 중인 녹음을 먼저 멈춰요."
  if [ -f "$REC_SCRIPT" ]; then
    MEETING_RECORD_STATE="$REC_STATE" bash "$REC_SCRIPT" --stop || true
  fi
  if ps -p "$pid" -o command= 2>/dev/null | grep -q meeting-capture; then
    kill -INT "$pid" 2>/dev/null || true
    sleep 3
  fi
  if ps -p "$pid" -o command= 2>/dev/null | grep -q meeting-capture; then
    echo "녹음이 아직 돌고 있어 지우지 않았어요."; return 1
  fi
  return 0
}

# 127.0.0.1:$PORT 에서 이 앱 폴더로 돌아가는 next 서버만 끈다. 다른 프로그램은 건드리지 않는다.
stop_server() {
  local pids pid cwd app_real
  command -v lsof >/dev/null 2>&1 || return 0
  app_real="$(cd "$APP_DIR" 2>/dev/null && pwd -P || printf '%s' "$APP_DIR")"
  pids="$(lsof -nP -iTCP@127.0.0.1:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  for pid in $pids; do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    [ "$cwd" = "$app_real" ] || [ "$cwd" = "$APP_DIR" ] || continue
    ps -p "$pid" -o command= 2>/dev/null | grep -q next || continue
    echo "실행 중인 앱을 꺼요."
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    if kill -0 "$pid" 2>/dev/null; then
      echo "앱이 꺼지지 않아 지우지 않았어요. 앱 창을 닫고 다시 실행하세요."; return 1
    fi
  done
  return 0
}

main() {
  local why
  why="$(guard_path "앱" "$APP_DIR")" || { echo "$why"; exit 1; }
  why="$(guard_path "도구" "$TOOLS_DIR")" || { echo "$why"; exit 1; }
  # 녹음을 먼저 멈춘다(종료가 서버로 업로드하므로 서버보다 먼저).
  stop_recording || exit 1
  stop_server || exit 1
  if has_marker "$APP_DIR" app && [ -d "$APP_DIR/data" ] && [ -n "$(ls -A "$APP_DIR/data" 2>/dev/null)" ]; then
    local backup="$HOME/Desktop/심플리홈 스튜디오 기록 백업 $(date +%Y%m%d-%H%M%S)"
    cp -R "$APP_DIR/data" "$backup"
    echo "기록을 백업했어요: $backup"
  fi
  local ok=1
  safe_remove_dir "앱" "$APP_DIR" app || ok=0
  safe_remove_dir "도구" "$TOOLS_DIR" tools || ok=0
  case "$LAUNCHER" in *.command) [ -L "$LAUNCHER" ] || rm -f -- "$LAUNCHER" ;; esac
  [ "$ok" = 1 ] || { echo "일부 폴더는 남겼어요."; exit 1; }
  echo "심플리홈 스튜디오를 지웠어요."
}
main "$@"
