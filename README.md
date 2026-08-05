# nomute_homepage

노뮤트(nomute) 웹사이트 — Astro + Starlight.

## 구조

```
.
├── src/
│   ├── pages/index.astro   # 메인 랜딩 페이지 (실질 본체)
│   ├── drafts/             # 랜딩 시안 버전 (index2 · index3 · index44)
│   ├── content/docs/       # Starlight 문서 (guides · reference)
│   ├── lib/                # 공용 로직
│   └── assets/
├── public/                 # 정적 에셋 (favicon 등)
├── scripts/
│   └── viewport_audit.js   # 뷰포트 폭 감사기 (수동 실행)
├── docs/reports/           # 보고서 산출 (기계산출물 · 손편집 금지)
├── astro.config.mjs
└── package.json
```

## 명령

| 명령 | 동작 |
| --- | --- |
| `npm install` | 의존성 설치 |
| `npm run dev` | 로컬 개발 서버 (`localhost:4321`) |
| `npm run build` | 프로덕션 빌드 → `./dist/` |
| `npm run preview` | 빌드 미리보기 |
| `npm run audit:viewport` | 뷰포트 폭 감사 (`npm run build` 후 실행) |

### 뷰포트 폭 감사

`npm run audit:viewport` — 빌드 산출을 여러 화면 폭으로 실렌더해 **특정 폭에서만 깨지는** 결함을 찾는다.
폭 사다리는 CSS 미디어쿼리·컨테이너 `max-width`를 실측해 짜고, 거기에 **구간 중점**을 넣는다
(결함은 브레이크포인트 경계가 아니라 구간 한가운데에 산다 — 260805 헤더 그라데이션 절단이 480~768px
구간에서만 보였던 게 실증 사례다).

- **가로 오버플로** = 하드 판정(종료코드 1). 넘치는 원소까지 지목한다.
- **세로 단차** = 참고 판정. 좌우 영역 밝기가 통째로 갈리는 경계선만 올리고, 카드 테두리 같은 얇은 선과
  이미지·글자 내부는 뺀다. 최종 판정은 보고서 스샷을 사람이 보고 한다.

산출 = `docs/reports/{yymmdd}_뷰포트감사.html`(자기완결 1파일 · 외부 요청 0).
브라우저는 시스템 Chromium을 쓴다 — 못 찾으면 `CHROME_PATH=/경로/chrome npm run audit:viewport`.
**수동 실행 전용** — 훅·pre-commit·크론에 붙이지 않는다.

문서 페이지는 `src/content/docs/` 아래에 `.md`/`.mdx`를 추가하면 파일명 기준으로 라우트가 생긴다(사이드바는 자동 생성).
