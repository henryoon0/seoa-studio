#!/usr/bin/env bash
# 진단: 문제가 생기면 이 결과를 통째로 복사해 henry 에게 보내 주세요. 비밀값은 출력하지 않는다.
set -uo pipefail
APP_DIR="${SEOA_APP_DIR:-$HOME/SimplyhomeStudio}"
TOOLS_DIR="${SEOA_TOOLS_DIR:-$HOME/.seoa-studio}"
main() {
  echo "macOS: $(sw_vers -productVersion 2>/dev/null) ($(uname -m))"
  echo "node: $("$TOOLS_DIR/node/bin/node" -v 2>/dev/null || echo 없음)"
  echo "claude: $("$HOME/.local/bin/claude" --version 2>/dev/null || command -v claude || echo 없음)"
  echo "앱 폴더: $([ -f "$APP_DIR/package.json" ] && echo 있음 || echo 없음)"
  echo "앱 빌드: $([ -d "$APP_DIR/.next" ] && echo 있음 || echo 없음)"
  echo "설정 파일: $([ -f "$APP_DIR/data/settings.json" ] && echo 있음 || echo 없음)"
  echo "앱 실행: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/settings 2>/dev/null || echo 꺼짐)"
  echo "녹음 도구:"
  "$APP_DIR/bin/meeting-capture" --doctor 2>&1 | sed 's/^/  /'
}
main "$@"
