# 심플리홈 스튜디오

서아님(심플리홈) 인스타 댓글에 서아님 말투 초안으로 답하고, 회의를 녹음해 회의록으로 정리하는 맥 앱입니다.

henry 의 업무 대시보드에서 **소통**과 **회의** 두 기능만 떼어 서아님 컴퓨터에서 혼자 돌게 만들었습니다. 데이터는 서아님 맥 안에만 저장됩니다.

## 설치 (10분 안팎)

1. 이 페이지 위쪽 초록색 **Code** 버튼 → **Download ZIP** 을 누르세요.
2. 다운로드 폴더에서 받은 ZIP 을 더블클릭해 압축을 푸세요.
3. 터미널(Spotlight 에서 "터미널" 검색)을 열고 아래 한 줄을 붙여넣은 뒤 Enter 를 누르세요.

```bash
bash ~/Downloads/seoa-studio-main/install.sh
```

Homebrew, 관리자 비밀번호, 개발 도구는 필요 없어요.

설치가 끝나면 터미널에 **직접 해 주실 일 3가지**가 나옵니다.

1. **Claude 로그인.** 터미널에 `~/.local/bin/claude` 를 붙여넣고 Enter 를 누르세요. 브라우저가 열리면 Claude 계정으로 로그인하세요. 답글 초안과 회의 요약은 서아님의 Claude 구독으로 만들어집니다. 그래서 로그인은 서아님만 할 수 있어요.
2. **앱 켜기.** 바탕화면의 **심플리홈 스튜디오** 를 더블클릭하세요. 브라우저에 앱이 열립니다.
3. **연결 넣기.** 앱 왼쪽 위 톱니바퀴(설정)를 누르세요. henry 가 보내 드린 **인스타 토큰**과 **ElevenLabs API 키**를 붙여 넣으세요. 저장하면 줄마다 초록색 ✓ 가 뜹니다.

## 사용법

### 소통 (인스타 댓글)

1. 왼쪽 **소통** 을 누르면 아직 답하지 않은 댓글이 나옵니다.
2. 댓글마다 서아님 말투 초안 3가지(짧게 · 따뜻하게 · 안내)가 미리 들어가 있어요.
3. **Tab** 을 누르면 다음 초안으로 바뀝니다. 고칠 곳이 있으면 바로 고치세요.
4. **Enter** 를 누르면 발송 대기줄에 들어가요. 대기줄은 10~20초 간격으로 하나씩 인스타에 올립니다.
5. **Esc** 는 그 댓글을 건너뜁니다. **Shift+Enter** 는 줄바꿈입니다.

### 회의

1. 왼쪽 **회의** 에서 녹음 버튼을 누르세요. **원격** 은 내 목소리와 상대방 소리(줌·구글 미트)를 따로 녹음하고, **대면** 은 마이크만 녹음합니다.
2. 처음 녹음할 때 맥이 두 가지를 물어요. 둘 다 **허용** 을 누르세요.
   - "터미널이 마이크에 접근하려고 합니다"
   - "터미널이 시스템 오디오를 녹음하려고 합니다" (원격 녹음일 때)
3. 녹음을 끝내면 ElevenLabs 가 글로 바꾸고, Claude 가 요약·결정·할 일을 정리합니다. 1시간 회의 기준 몇 분 걸립니다.

## AI 에이전트에게 설치를 맡길 때

Claude Code 에게 받은 폴더를 가리키며 "이 앱 설치해줘"라고 하면 됩니다.

> **For AI agents:**
> 1. Run `bash <unzipped folder>/install.sh`. It needs no sudo, no Homebrew, no Xcode tools. It installs Node 22.12.0 into `~/.seoa-studio/node`, copies the app to `~/SimplyhomeStudio`, builds it, installs the Claude CLI with the official script if missing, and creates `~/Desktop/심플리홈 스튜디오.command`.
> 2. You cannot do these steps for the user: Claude login (`claude` opens a browser OAuth flow), and macOS microphone / system-audio permission prompts. Ask the user to do them.
> 3. The Instagram token and ElevenLabs key are pasted in the app's settings page (`http://127.0.0.1:3100/settings`). Never print them.
> 4. Success: `curl -s -X POST -H "Content-Type: application/json" -d '{"check":"all"}' http://127.0.0.1:3100/api/settings` (no Origin header needed from curl) returns `"ok":true` for claude, instagram and elevenlabs.

## 안 될 때

터미널에 아래 한 줄을 붙여넣고, 나온 결과를 통째로 henry 에게 보내 주세요. 비밀값은 출력되지 않아요.

```bash
bash ~/SimplyhomeStudio/doctor.sh
```

- **브라우저에 앱이 안 열려요.** 바탕화면의 심플리홈 스튜디오를 다시 더블클릭하세요. 앱이 켜져 있는 동안 터미널 창을 닫으면 안 됩니다.
- **설정에서 Claude 가 ✕ 예요.** 터미널에서 `~/.local/bin/claude` 를 실행해 로그인을 다시 하세요.
- **녹음 버튼을 눌러도 녹음이 안 돼요.** 시스템 설정 › 개인정보 보호 및 보안 › 마이크 에서 **터미널** 을 켜세요. 원격 녹음은 같은 화면의 **화면 및 시스템 오디오 녹음** 에서도 켜야 해요.

## 업데이트

새 ZIP 을 받아 압축을 풀고, 설치 명령을 다시 실행하세요. 회의·답글 기록은 그대로 남습니다.

## 알아두면 좋은 점

- 설치가 만드는 것: `~/SimplyhomeStudio`(앱과 기록), `~/.seoa-studio`(Node), 바탕화면의 실행 아이콘, Claude(없을 때만).
- 기록은 `~/SimplyhomeStudio/data` 에 있어요. 인터넷 서버에 올라가지 않습니다. 녹음 파일은 `~/Recordings/meetings` 에 남습니다.
- 맥 전용입니다. 원격 회의의 상대방 소리 녹음은 macOS 14.2 이상에서 됩니다.
- 시험한 환경과 시험하지 않은 환경은 `docs/TESTING.md` 에 적었습니다.

## 제거

```bash
bash ~/SimplyhomeStudio/uninstall.sh
```

회의·답글 기록은 바탕화면에 백업한 뒤 지웁니다. Claude 는 지우지 않아요.

## 파일 구성

| 파일 | 하는 일 |
| --- | --- |
| `install.sh` | Node 준비 → 앱 복사 → 앱 만들기 → Claude 준비 → 실행 아이콘 만들기 |
| `uninstall.sh` | 설치가 만든 것만 지우기 (기록은 백업) |
| `doctor.sh` | 진단 결과 출력 |
| `voice/` | 서아님 말투 규격(`VOICE.md`)과 실제 답글 DB. 초안이 이걸 따라 씁니다 |
| `bin/meeting-capture` | 녹음 도구 (애플 칩·인텔 공용, 미리 만들어 둠) |
| `scripts/recording/` | 녹음 시작·종료·업로드 스크립트와 녹음 도구 소스 |
| `src/` | 앱 화면과 서버 코드 |
| `GLOSSARY.md` | 이 앱에서 쓰는 용어 |
