#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# 기틀 훅킷 v2 (운영자 260716 · nomute-editor발 전파 킷 — 레포 무관)
# v2: 대상 레포 CLAUDE.md에 [0] 조항이 없으면 내장 정본 [0]을 대신 주입(있으면 그 레포 것 우선)
#     → 타 레포는 이 킷 설치 하나로 끝(CLAUDE.md에 아무것도 안 붙여도 됨).
# v2.1: 주입에 '기계산출물 손편집 금지' 포터블 공통규약 추가(전 레포 전파 · 운영자 260716).
#
# 목적: 어느 레포든 세션 시작마다 {① CLAUDE.md [0] 최고 규범 ② 평의회 억제
#       전달사항(단순 변경에 다중검증 발동 금지 — 토큰 과소비 방지) ③ 참조 경로
#       목록}을 Claude 컨텍스트에 자동 주입 → "CLAUDE.md까지만 읽고 참조 파일을
#       안 열어 값을 창작"하는 사고(예: 정본 마진 15 → 임의 13) 차단.
# 원칙: 이 킷은 대상 레포의 CLAUDE.md를 일절 수정하지 않는다(복잡화 0 — 운영자 260716).
#
# 설치(대상 레포 루트에서 · 파일을 아무 데나 복사해 두고):
#     bash <이 파일 경로> --install
#   → ① .claude/hooks/foundation_hook.sh 로 자기 복사
#     ② .claude/settings.json 에 SessionStart 훅 등록(기존 설정 보존 병합·멱등)
# 미리보기:  bash .claude/hooks/foundation_hook.sh   (세션에 주입될 내용 출력)
# 제거:      .claude/settings.json 의 해당 항목 + .claude/hooks/foundation_hook.sh 삭제
#
# 원칙: fail-soft — CLAUDE.md가 없든 파싱이 깨지든 세션 시작을 절대 막지 않는다(exit 0).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
CM="$ROOT/CLAUDE.md"

if [ "${1:-}" = "--install" ]; then
  mkdir -p "$ROOT/.claude/hooks"
  cp "$0" "$ROOT/.claude/hooks/foundation_hook.sh" && chmod +x "$ROOT/.claude/hooks/foundation_hook.sh"
  python3 - "$ROOT/.claude/settings.json" <<'PY'
import json, os, sys
p = sys.argv[1]
cmd = 'bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/foundation_hook.sh"'
try:
    cfg = {}
    if os.path.exists(p):
        with open(p, encoding='utf-8') as f:
            cfg = json.load(f)
    groups = cfg.setdefault('hooks', {}).setdefault('SessionStart', [])
    if any(h.get('command') == cmd for g in groups for h in g.get('hooks', [])):
        print('✅ settings.json — 이미 등록됨(멱등 통과)')
    else:
        groups.append({'matcher': 'startup|resume|compact',
                       'hooks': [{'type': 'command', 'command': cmd, 'timeout': 10}]})
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('✅ settings.json — SessionStart 등록 완료')
except Exception as e:
    print(f'⚠ settings.json 자동 병합 실패({e}) — 수동 등록: hooks.SessionStart 에 command={cmd}')
PY
  echo "✅ 설치 끝 — 미리보기: bash .claude/hooks/foundation_hook.sh · 커밋하면 다음 세션부터 자동 주입"
  exit 0
fi

# ── 주입 모드(SessionStart) ──────────────────────────────────────────────────
[ -f "$CM" ] || { echo "[기틀 훅킷] CLAUDE.md 없음 — 기틀 미탑재 레포(주입 생략)"; exit 0; }

echo "[🔒 기틀 자동 주입(훅킷 v2) — 아래 규범과 참조 경로는 매 세션 유효. 값·규칙은 참조 파일을 '실제로 열어' 실측한 정본만 사용 — 미열람 추측·창작 = 오류]"
awk '/^\[0\]/{f=1} f{print; if(/^[[:space:]]*$/) exit}' "$CM" | head -8
grep -q '^\[0\]' "$CM" || cat <<'Z0'
[0] (최고 규범 · 운영자 260716 · 훅킷 내장 기본판 — 이 레포 CLAUDE.md에 [0]이 생기면 그쪽이 우선) 모든 기준(디자인 UIUX·법칙)은 레포 최상위 CLAUDE.md와, 이 파일이 참조시키는 경로의 내용(연쇄 참조 포함)을 따른다. 참조가 걸린 작업은 그 참조 파일을 실제로 열어 정본 값을 쓴다 — CLAUDE.md까지만 읽고 값을 추측·창작한 결과물은 '오류' = 무효·정본 기준 재작업(예: 참조 디자인 파일의 정본 마진 15를 안 열어보고 13으로 임의 제작 = 오류). 기틀 증축은 핵심만 압축해 넣는다.
Z0
echo "[⚖ 평의회 억제(운영자 260716) — 단순 디자인·국소 손질에 평의회(다중 병렬 검증) 발동 금지 = 토큰 과소비. 평의회는 기틀 문서·토큰 구조·동작 로직·전반급 변경만. 루틴·크론·백그라운드 임의 부착도 동일 축 금지]"
echo "[⚙ 기계산출물 손편집 금지(운영자 260716) — 스크래퍼·빌더가 뽑는 데이터·거울 파일은 세션이 손으로 안 고친다. 값 변경 = '생성하는 코드'를 고쳐 다음 실행이 재생성하게 한다(손편집 = 크론·타세션 자동커밋과 병합 레이스·거울 드리프트 사고원). 레포별 대상 목록 = 레포구조 절]"
echo "── 참조 경로(정본 — 값의 원천 · 작업 전 해당 파일 열람 필수):"
sed 's/·/\n/g' "$CM" \
  | grep -oE '[A-Za-z0-9_가-힣.-]+(/[A-Za-z0-9_가-힣.-]+)*\.(md|html|css|js|json|py|sh)' \
  | sort -u | while IFS= read -r rp; do
      if [ -e "$ROOT/$rp" ]; then printf '%s\n' "$rp"
      else (cd "$ROOT" && git -c core.quotepath=false ls-files -- "*/$rp" 2>/dev/null | grep -v '^_versions/' | head -1); fi   # 상대 언급 → 실경로 해석(백업 폴더 제외)
    done | sort -u | sed 's/^/  · /' | head -40
exit 0
