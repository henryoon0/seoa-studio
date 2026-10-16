# install.sh·uninstall.sh 가 함께 쓰는 경로 안전 검사. source 해서 쓴다.
# 설치 폴더를 잘못 지정해 개인 파일을 지우는 사고를 막는다.
MARKER_NAME=".simplyhome-studio"

# 지워도 되는 경로가 아니면 이유를 출력하고 실패한다.
guard_path() {
  local label="$1" dir="$2" parent real
  [ -n "$dir" ] || { echo "$label 경로가 비어 있습니다"; return 1; }
  case "$dir" in /*) ;; *) echo "$label 경로는 절대 경로여야 합니다: $dir"; return 1 ;; esac
  [ -L "$dir" ] && { echo "$label 경로가 바로가기(symlink)입니다: $dir"; return 1; }
  parent="$(dirname "$dir")"
  if [ -d "$parent" ]; then
    real="$(cd "$parent" && pwd -P)/$(basename "$dir")"
  else
    real="$dir"
  fi
  # 끝의 / 를 모두 떼서 비교한다. 루트(/)는 빈 문자열이 된다.
  while [ "${real%/}" != "$real" ]; do real="${real%/}"; done
  while [ "${dir%/}" != "$dir" ]; do dir="${dir%/}"; done
  [ -n "$real" ] && [ -n "$dir" ] || { echo "$label 경로로 쓸 수 없는 폴더입니다: /"; return 1; }
  local home_real
  home_real="$(cd "$HOME" 2>/dev/null && pwd -P || printf '%s' "$HOME")"
  local bad
  for bad in "$HOME" "$home_real" \
    "$HOME/Desktop" "$HOME/Documents" "$HOME/Downloads" \
    "$home_real/Desktop" "$home_real/Documents" "$home_real/Downloads" \
    /Users /Applications /System /Library /usr /bin /etc /tmp /private/tmp /var /private; do
    if [ "$real" = "${bad%/}" ] || [ "$dir" = "${bad%/}" ]; then
      echo "$label 경로로 쓸 수 없는 폴더입니다: $dir"; return 1
    fi
  done
  return 0
}

# 표시 파일이 생기기 전 버전으로 설치된 앱 폴더도 우리 것으로 본다.
has_marker() {
  [ -f "$1/$MARKER_NAME" ] && return 0
  [ "$2" = app ] && grep -q '"name": "seoa-studio"' "$1/package.json" 2>/dev/null && return 0
  [ "$2" = tools ] && [ -x "$1/node/bin/node" ] && [ "$(ls -A "$1" | grep -v '^node$' | grep -v "^$MARKER_NAME\$")" = "" ] && return 0
  return 1
}

# 설치용: 비어 있지 않은 기존 폴더는 우리 표시 파일이 있어야 쓴다.
guard_install_dir() {
  guard_path "$1" "$2" || return 1
  if [ -d "$2" ] && [ -n "$(ls -A "$2" 2>/dev/null)" ] && ! has_marker "$2" "$3"; then
    echo "$1 폴더에 다른 파일이 있습니다. 비어 있는 폴더를 지정하세요: $2"; return 1
  fi
  return 0
}

# 삭제용: 표시 파일이 있는 폴더만 지운다.
safe_remove_dir() {
  local label="$1" dir="$2" kind="$3"
  [ -e "$dir" ] || [ -L "$dir" ] || return 0
  guard_path "$label" "$dir" || return 1
  if ! has_marker "$dir" "$kind"; then
    echo "$label 폴더에 설치 표시가 없어 지우지 않았습니다: $dir"; return 1
  fi
  rm -rf -- "${dir:?}"
}
