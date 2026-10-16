# 용어집 (심플리홈 스튜디오)

이 앱에서 쓰는 이름을 고정한다. 코드·문서·대화에서 이 이름을 그대로 쓴다.
말투 관련 용어(단비님·채널·다이얼 등)는 `voice/GLOSSARY.md` 에 있다.

## 앱

| 용어 | 뜻 |
|---|---|
| 심플리홈 스튜디오 | 이 앱. henry 대시보드에서 소통·회의만 떼어 서아님 맥에서 돌게 만든 것. |
| 원본 대시보드 | `workspace/dashboard`. 이 앱 코드의 출처. 고친 점은 아래 "원본과 다른 점". |
| 소통 | 인스타 댓글 답글 화면(`/instagram-comments`). |
| 회의 | 녹음 → 받아쓰기 → 회의록 화면(`/meetings`). |
| 설정 | 연결 3개(Claude·인스타·ElevenLabs)를 넣고 확인하는 화면(`/settings`). 값은 `data/settings.json`. |

## 소통

| 용어 | 뜻 |
|---|---|
| 원장 | 수집한 게시물·댓글·발송 기록을 담은 로컬 파일(`data/instagram-comments/`). |
| 남은 댓글 | 아직 답하지 않았고 건너뛰지도 않은 댓글. |
| 초안 3가지 | short(짧게)·warm(따뜻하게)·guide(안내). Tab 으로 넘긴다. |
| 발송 대기줄 | Enter 로 승인한 답글이 10~20초 간격으로 하나씩 나가는 줄. 동시 발송은 없다. |
| 말투 규격 | `voice/VOICE.md`. 초안 프롬프트의 바탕. `data/instagram-reply-prompt.md` 가 있으면 그게 먼저다. |
| 말투 예시 | 초안에 붙이는 서아님 실제 답글. 원장의 내 답글 4개 + `voice/db/replies.jsonl` 에서 비슷한 답글. |
| 인스타 토큰 | 서아님 계정의 Instagram API 접근 권한. 60일짜리이고 앱이 만료 7일 전에 스스로 연장한다. |

## 회의

| 용어 | 뜻 |
|---|---|
| 원격 녹음 | 마이크와 시스템 소리(상대방)를 따로 녹음. macOS 14.2 이상. |
| 대면 녹음 | 마이크만 녹음. |
| 녹음 도구 | `bin/meeting-capture`. 미리 만든 파일이라 개발 도구가 필요 없다. 다시 만들 때는 `scripts/build-capture.sh`. |
| 받아쓰기 | ElevenLabs API. whisper 는 쓰지 않는다. |
| 회의 분석 | Claude 가 요약·결정·할 일을 뽑는 단계. |

## 원본과 다른 점

- AI 는 Claude 하나만 쓴다(원본은 ChatGPT/Codex 도 쓴다).
- 받아쓰기는 ElevenLabs 만 쓴다. whisper·ffmpeg 가 없어서 녹음 중 실시간 요약은 꺼져 있다.
- 소통에는 인스타 댓글만 있다. Threads·DM·리그램·자동화 규칙은 없다.
- 회의의 웹 공유, 할 일 앱 연동, 휴대폰 음성 메모 가져오기는 뺐다.
- 녹음 파일은 업로드 전에 macOS 기본 도구(afconvert)로 m4a 로 바꾼다.

## henry 가 갱신할 때

1. 말투가 바뀌면 `workspace/seoa-voice` 를 고친 뒤 `bash scripts/sync-voice.sh`.
2. 녹음 도구 소스를 고치면 `bash scripts/build-capture.sh`.
3. 원본 대시보드의 소통·회의 개선을 가져올 때는 해당 파일만 비교해 옮긴다. 위 "원본과 다른 점"을 깨지 않는지 확인한다.
