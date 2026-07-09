#!/usr/bin/env python3
"""bg_gate.py — 백그라운드 실행 승인 팝업 강제 게이트 (PreToolUse · Bash · 운영자 A안 확정).

§백그라운드 절대명령: Bash `run_in_background=true`는 무조건 운영자 승인 팝업("ask")을 강제한다.
- 백그라운드 아님·Bash 아님·입력 파싱 실패 = 무의견(출력 없이 종료) → 기존 권한 흐름 그대로(오차단 0).
- 에이전트/워크플로 축은 의도적 비대상(평의회 다인 소환 팝업 폭주 방지) — 그쪽은 CLAUDE.md 소프트 룰.
등재 = `.claude/settings.json` hooks.PreToolUse(matcher "Bash").
"""
import json
import sys


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    if data.get("tool_name") != "Bash":
        return
    tool_input = data.get("tool_input") or {}
    if not tool_input.get("run_in_background"):
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": "§백그라운드 절대명령 — 백그라운드 실행은 운영자 승인 후에만(이 팝업 승인 = 승인)",
        }
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
