#!/usr/bin/env bash
# 심플리홈 스튜디오 설치. 받은 폴더 안에서 실행한다:
#   bash ~/Downloads/seoa-studio-main/install.sh
# 두 번 실행해도 같은 결과다. 이미 쓰던 데이터(data/)는 지우지 않는다.
set -euo pipefail

NODE_VERSION="22.12.0"
NODE_SHA_ARM64="293dcc6c2408da21562d135b0412525e381bb6fe150d688edb58fe850d0f3e13"
NODE_SHA_X64="52bc25dd026db7247c3c00439afdb83e95087248267f02d6c1a7250d1f896173"
APP_DIR="${SEOA_APP_DIR:-$HOME/SimplyhomeStudio}"
TOOLS_DIR="${SEOA_TOOLS_DIR:-$HOME/.seoa-studio}"
LAUNCHER="${SEOA_LAUNCHER:-$HOME/Desktop/심플리홈 스튜디오.command}"

GUARD="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)/scripts/install-guard.sh"
[ -f "$GUARD" ] || { echo "받은 폴더 안의 install.sh 를 실행해 주세요."; exit 1; }
# shellcheck source=scripts/install-guard.sh
. "$GUARD"

say() { printf '\n▶ %s\n' "$1"; }
fail() { printf '\n✕ %s\n' "$1" >&2; exit 1; }

check_os() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "심플리홈 스튜디오는 맥 전용입니다. 이 컴퓨터에는 아무것도 바꾸지 않았어요."
    echo "맥에서 같은 명령을 다시 실행해 주세요."
    exit 0
  fi
  local ver major minor
  ver="$(sw_vers -productVersion)"
  major="${ver%%.*}"; minor="$(printf '%s' "$ver" | cut -d. -f2)"
  if [ "$major" -lt 14 ] || { [ "$major" -eq 14 ] && [ "${minor:-0}" -lt 2 ]; }; then
    echo "⚠ macOS $ver 입니다. 원격 회의의 상대방 소리 녹음은 macOS 14.2 이상에서만 됩니다."
    echo "  소통 기능과 대면 회의 녹음은 그대로 쓸 수 있어요."
  fi
}

source_dir() {
  # curl | bash 로 실행하면 옆 파일이 없다. 받은 폴더 안에서 실행해야 한다.
  local src="${BASH_SOURCE[0]:-}"
  if [ -n "$src" ] && [ -f "$src" ] && [ -f "$(dirname "$src")/package.json" ]; then
    (cd "$(dirname "$src")" && pwd)
  else
    fail "받은 폴더 안의 install.sh 를 실행해 주세요. 예: bash ~/Downloads/seoa-studio-main/install.sh"
  fi
}

install_node() {
  local arch sha url tmp
  if [ -x "$TOOLS_DIR/node/bin/node" ] && [ "$("$TOOLS_DIR/node/bin/node" -v)" = "v$NODE_VERSION" ]; then
    echo "Node $NODE_VERSION 이미 있음"
    return
  fi
  case "$(uname -m)" in
    arm64) arch="arm64"; sha="$NODE_SHA_ARM64" ;;
    *) arch="x64"; sha="$NODE_SHA_X64" ;;
  esac
  url="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$arch.tar.gz"
  tmp="$(mktemp -d)"
  echo "Node $NODE_VERSION 받는 중 (약 45MB)"
  curl -fsSL "$url" -o "$tmp/node.tar.gz" || fail "Node 를 받지 못했어요. 인터넷 연결을 확인해 주세요."
  [ "$(shasum -a 256 "$tmp/node.tar.gz" | awk '{print $1}')" = "$sha" ] || fail "받은 Node 파일이 공식 파일과 달라요. 다시 실행해 주세요."
  mkdir -p "$TOOLS_DIR"
  touch "$TOOLS_DIR/$MARKER_NAME"
  rm -rf -- "${TOOLS_DIR:?}/node"
  tar -xzf "$tmp/node.tar.gz" -C "$tmp"
  mv "$tmp/node-v$NODE_VERSION-darwin-$arch" "$TOOLS_DIR/node"
  rm -rf -- "${tmp:?}"
}

copy_app() {
  local src="$1"
  mkdir -p "$APP_DIR"
  touch "$APP_DIR/$MARKER_NAME"
  # 받은 파일의 "인터넷에서 받음" 표시를 지운다. 없으면 녹음 도구가 실행되지 않는다.
  xattr -dr com.apple.quarantine "$src" 2>/dev/null || true
  if [ "$src" != "$APP_DIR" ]; then
    rsync -a --delete \
      --exclude data/ --exclude node_modules/ --exclude .next/ --exclude .git/ \
      --exclude "/$MARKER_NAME" \
      "$src/" "$APP_DIR/"
  fi
  mkdir -p "$APP_DIR/data"
  chmod +x "$APP_DIR/bin/meeting-capture" "$APP_DIR/scripts/recording/meeting-record.sh"
}

build_app() {
  export PATH="$TOOLS_DIR/node/bin:$PATH"
  cd "$APP_DIR"
  echo "앱 준비 중 (처음에는 2~4분 걸려요)"
  mkdir -p "$APP_DIR/data"
  npm ci --no-audit --no-fund --loglevel=error >"$APP_DIR/data/install.log" 2>&1 \
    || fail "필요한 파일을 받지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요. (기록: $APP_DIR/data/install.log)"
  npm run build >>"$APP_DIR/data/install.log" 2>&1 \
    || fail "앱을 만들지 못했어요. $APP_DIR/data/install.log 파일을 henry 에게 보내 주세요."
}

install_claude() {
  if [ -x "$HOME/.local/bin/claude" ] || command -v claude >/dev/null 2>&1; then
    echo "Claude 이미 있음"
    return
  fi
  echo "Claude 설치 중 (공식 설치 스크립트)"
  curl -fsSL https://claude.ai/install.sh | bash >/dev/null || fail "Claude 를 설치하지 못했어요. 인터넷 연결을 확인해 주세요."
}

make_launcher() {
  cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
# 심플리홈 스튜디오 켜기. 이 창을 닫으면 앱도 꺼집니다.
export PATH="$TOOLS_DIR/node/bin:\$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$APP_DIR"
if curl -s -o /dev/null http://127.0.0.1:3100/api/settings; then
  open http://127.0.0.1:3100
  exit 0
fi
(sleep 4; open http://127.0.0.1:3100) &
echo "심플리홈 스튜디오가 켜졌어요. 쓰는 동안 이 창을 닫지 마세요."
exec npx next start -H 127.0.0.1 -p 3100
EOF
  chmod +x "$LAUNCHER"
}

main() {
  check_os
  local why
  why="$(guard_install_dir "앱" "$APP_DIR" app)" || fail "$why"
  why="$(guard_install_dir "도구" "$TOOLS_DIR" tools)" || fail "$why"
  local src
  src="$(source_dir)"
  say "1/4 Node 준비"
  install_node
  say "2/4 앱 복사"
  copy_app "$src"
  say "3/4 앱 만들기"
  build_app
  say "4/4 Claude 준비"
  install_claude
  make_launcher

  local claude_cmd="claude"
  command -v claude >/dev/null 2>&1 || claude_cmd="~/.local/bin/claude"

  cat <<EOF

✓ 설치가 끝났어요.

이제 직접 해 주실 일 3가지:
  1. 터미널에 $claude_cmd 를 입력하고 Enter. 브라우저가 열리면 Claude 계정으로 로그인하세요.
     (로그인이 끝나면 터미널에서 /exit 를 입력해 닫으세요)
  2. 바탕화면의 "심플리홈 스튜디오"를 더블클릭하세요. 브라우저에 앱이 열립니다.
  3. 앱 왼쪽 위 톱니바퀴(설정)에서 인스타 토큰과 ElevenLabs 키를 붙여 넣으세요.

회의를 처음 녹음할 때 맥이 "터미널이 마이크에 접근하려고 합니다"를 물으면 [허용]을 누르세요.
EOF
}

main "$@"
