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

문서 페이지는 `src/content/docs/` 아래에 `.md`/`.mdx`를 추가하면 파일명 기준으로 라우트가 생긴다(사이드바는 자동 생성).
