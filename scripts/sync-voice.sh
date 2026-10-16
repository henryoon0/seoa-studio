#!/usr/bin/env bash
# 말투 모듈(workspace/seoa-voice)의 최신본을 이 저장소 voice/ 로 복사한다. henry 컴퓨터에서만 쓴다.
set -euo pipefail
main() {
  local here src
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  src="${SEOA_VOICE_DIR:-$here/../seoa-voice}"
  [ -f "$src/VOICE.md" ] || { echo "seoa-voice 폴더를 찾지 못했어요: $src"; exit 1; }
  cp "$src/VOICE.md" "$src/GLOSSARY.md" "$here/voice/"
  cp "$src/db/stats.json" "$here/voice/db/"
  # 앱이 쓰는 필드(question, reply, auto)만 옮긴다. 게시물 ID·날짜는 앱에 필요 없다.
  python3 - "$src/db/replies.jsonl" "$here/voice/db/replies.jsonl" "$here/voice/db/excluded.txt" <<'PY'
import hashlib, json, re, sys

# 사람이 한 줄씩 읽고 제3자 민감 정보(건강·아이·가족사·학교·직장 등)로 고른 줄.
# 원문 대신 sha1(question + "\n" + reply)만 적어 둔다. 키워드로 못 잡는 줄을 막는다.
EXCLUDED = set()
try:
    with open(sys.argv[3]) as f:
        EXCLUDED = {l.split()[0] for l in f if l.strip() and not l.startswith("#")}
except FileNotFoundError:
    pass

def key(r):
    return hashlib.sha1(((r.get("question") or "") + "\n" + (r.get("reply") or "")).encode()).hexdigest()

# 제3자를 알아볼 수 있는 줄은 통째로 뺀다(고쳐 쓰지 않는다).
# 서아님·단비님은 이 앱의 주인공이라 이름이 나와도 된다.
PHONE = re.compile(r"0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}")
ADDRESS = re.compile(
    r"(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)"
    r"(?:특별시|광역시|특별자치시|특별자치도)?\s[가-힣]+(?:구|군|시)\s?[가-힣0-9]*(?:동|로|길)"
    r"|\d+번지|아파트\s?\d+동|[가-힣]{2,}(?:로|길)\s?\d+(?:-\d+)?(?:번지|호)"
)
SCHOOL = re.compile(
    r"[가-힣]{2,}(?:여고|여중|초등학교|중학교|고등학교|대학교|초교|고교)"
    r"|[가-힣]{2,}(?:초|중|고)\s?(?:동창|친구|선후배|선배|후배)|동창"
)
# "○○님/씨" 앞의 2~3글자 이름(호칭·역할 말은 제외).
NAMED = re.compile(r"(?<![가-힣])([가-힣]{2,3})(?:님|씨)(?![가-힣])")
OK_WORDS = {
    "서아", "단비", "심플리", "대표", "선생", "아버", "목사", "선배", "부모", "이사", "남편",
    "애기", "직원", "교관", "고수", "대장", "아드", "고객", "신랑", "와이프", "사장", "마음",
    "원장", "공주", "파파", "단정", "어머", "어머니", "아버지", "시어머", "시아버", "아기",
}

def reveals_third_party(text):
    if PHONE.search(text) or ADDRESS.search(text) or SCHOOL.search(text):
        return True
    return any(m.group(1) not in OK_WORDS for m in NAMED.finditer(text))

dropped = total = 0
with open(sys.argv[1]) as fi, open(sys.argv[2], "w") as fo:
    for line in fi:
        if not line.strip():
            continue
        total += 1
        r = json.loads(line)
        if key(r) in EXCLUDED or reveals_third_party((r.get("question") or "") + "\n" + (r.get("reply") or "")):
            dropped += 1
            continue
        fo.write(json.dumps({k: r.get(k) for k in ("question", "reply", "auto")}, ensure_ascii=False) + "\n")
print(f"말투 예시 {total}줄 중 {dropped}줄 제외(제3자 개인정보 가능성)", file=sys.stderr)
PY
  echo "voice/ 갱신 완료"
}
main "$@"
