#!/usr/bin/env bash
# 녹음 도구(bin/meeting-capture)를 애플 칩·인텔 맥 공용으로 다시 만든다. henry 컴퓨터에서만 쓴다.
# 받는 사람은 이 파일을 실행하지 않는다(만들어진 파일이 저장소에 들어 있다).
set -euo pipefail
main() {
  local here tmp
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  tmp="$(mktemp -d)"
  for arch in arm64 x86_64; do
    xcrun swiftc -O -target "$arch-apple-macos14.2" \
      -framework AVFoundation -framework CoreAudio \
      "$here/scripts/recording/AudioTracks.swift" "$here/scripts/recording/main.swift" \
      -o "$tmp/capture-$arch"
  done
  mkdir -p "$here/bin"
  lipo -create "$tmp/capture-arm64" "$tmp/capture-x86_64" -output "$here/bin/meeting-capture"
  codesign --force --sign - "$here/bin/meeting-capture"
  rm -rf "$tmp"
  lipo -info "$here/bin/meeting-capture"
}
main "$@"
