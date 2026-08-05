#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// viewport_audit.js — 뷰포트 폭 감사기 (운영자 260805 채택)
//
// 무엇: 빌드 산출(dist/)을 여러 화면 폭으로 실렌더해 「특정 폭에서만 깨지는」 결함 2종을 기계 검출.
//   ① 가로 오버플로 (하드 판정) — scrollWidth > clientWidth. 넘치는 원소까지 지목.
//   ② 세로 이음매 (참고 판정) — 렌더 픽셀에서 열(column) 단위 휘도 급변이 세로로 길게 이어지는 자리.
//      = 260805 헤더 그라데이션 좌우 절단이 눈에 띄던 바로 그 신호(워시가 480px 기둥에서 끊긴 경계선).
//
// 왜 이음매는 참고인가(정직): 카드 테두리·이미지 경계처럼 '의도된' 세로 경계선도 같은 신호를 낸다.
//   하드 판정은 오버플로 축만(위양성 0). 이음매는 좌표·스샷과 함께 사람이 보고 판정한다
//   — 삭제된 shared/measure_align.js가 「기하=하드 / 잉크=참고」로 갈랐던 그 규율 계승.
//
// 왜 이 도구인가: 260805 결함은 480~768px(태블릿·작은 창)에서만 보였다. 폰(<480px)에서도 PC(≥768px)에서도
//   안 보여서 사람 눈을 통과했다. → 폭 사다리를 **미디어쿼리 실측 + 구간 중점**으로 짜는 게 핵심이다
//   (결함은 브레이크포인트 '경계'가 아니라 구간 '한가운데'에 산다).
//
// 사용(수동 실행 전용 · 훅·pre-commit·크론 편입 금지 = measure_align.js 헤더 규율 · 훅킷 「루틴 임의 부착 금지」 동축):
//   npm run build && npm run audit:viewport
//   옵션: --url <주소>      외부 주소 감사(기본 = dist/ 임시 서빙)
//         --band <px>      캡처 높이(기본 720 = 헤더·티커·히어로·첫 카드)
//         --widths a,b,c   폭 사다리 수동 지정(기본 = CSS 미디어쿼리 실측 + 중점 + 표준폭)
//         --out <경로>     보고서 경로(기본 docs/reports/{yymmdd}_뷰포트감사.html)
//   종료코드: 0 = 하드 판정 통과 · 1 = 가로 오버플로 검출 · 2 = 실행 불가(브라우저·dist 결측)
//
// 산출 = 기계산출물(손편집 금지 · 훅킷 v2.1) — 값 변경은 이 스크립트를 고쳐 재생성한다.
// 보고서 디자인 = docs/reports/260702_홈페이지_UIUX개선.html CSS 계승(신설 없음).
// ═══════════════════════════════════════════════════════════════════════════════
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

// ── 인자 ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const BAND = parseInt(arg("--band", "720"), 10);
const URL_IN = arg("--url", null);
const WIDTHS_IN = arg("--widths", null);
const yymmdd = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};
const OUT = path.resolve(
    ROOT,
    arg("--out", `docs/reports/${yymmdd()}_뷰포트감사.html`),
);

// ── 이음매 판정 상수(값 바꿀 땐 여기 한 곳 · 보고서에 그대로 인쇄된다) ──────────
const SEAM = {
    T: 6, // 인접 열 픽셀 휘도차 임계(0~255)
    AGREE: 0.9, // 창(window) 안에서 같은 방향으로 T를 넘는 행의 비율
    WIN: 64, // 세로 스캔 창 높이(px) — 헤더(≈96px)보다 작아야 국소 이음매를 잡는다
    STRIDE: 32, // 창 이동 간격(px)
    EDGE: 2, // 좌우 가장자리 무시 폭(px)
    // 단차(step) 판정 — 이음매 좌우 '영역'의 밝기가 통째로 다른가.
    // 결함(워시가 기둥에서 끊김) = 한쪽 영역 전체가 어두운 단차 · 카드 테두리·아이콘 = 얇은 선(양옆이 같음).
    // 이 한 축이 위양성의 대부분(테두리·글자)을 걷어낸다.
    SIDE_GAP: 3, // 이음매에서 이만큼 띄운 지점부터 영역 표본
    SIDE_SPAN: 7, // 영역 표본 폭(px)
    STEP_T: 8, // 좌우 영역 평균 휘도차 임계 = 이 이상이면 '단차'
};

const die = (code, msg) => {
    console.error(msg);
    process.exit(code);
};

// ── 브라우저 실행파일 탐색(playwright-core = 브라우저 미동봉 → 시스템/환경 것을 쓴다) ──
function findChromium() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cands = [
        process.env.PLAYWRIGHT_BROWSERS_PATH &&
            path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium"),
        "/opt/pw-browsers/chromium",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ].filter(Boolean);
    return cands.find((p) => {
        try {
            return fs.statSync(p).isFile();
        } catch {
            return false;
        }
    });
}

// ── dist/ 임시 정적 서빙(외부 의존 0) ─────────────────────────────────────────
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".otf": "font/otf",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
};
function serve(dir) {
    return new Promise((res) => {
        const srv = http.createServer((req, rq) => {
            let p = decodeURIComponent(req.url.split("?")[0]);
            if (p.endsWith("/")) p += "index.html";
            const f = path.join(dir, p);
            if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
                rq.writeHead(404).end("404");
                return;
            }
            rq.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
            fs.createReadStream(f).pipe(rq);
        });
        srv.listen(0, "127.0.0.1", () => res({ srv, port: srv.address().port }));
    });
}

// ── 폭 사다리 = CSS 미디어쿼리 실측 + 구간 중점 + 표준 기기폭 ─────────────────
// 결함은 브레이크포인트 '경계'가 아니라 구간 '한가운데'에 산다(260805 실증: 480↔768 사이 600px).
function buildLadder(bps) {
    const STD = [360, 390, 768, 1024, 1440]; // 흔한 실기기·창 폭
    const set = new Set(STD);
    for (const b of bps) {
        set.add(b);
        if (b > 1) set.add(b - 1); // 경계 직전(미디어쿼리 미적용 마지막 폭)
    }
    const sorted = [...bps].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
        set.add(Math.round((sorted[i] + sorted[i + 1]) / 2)); // ★ 구간 중점
    }
    return [...set].filter((w) => w >= 320 && w <= 1920).sort((a, b) => a - b);
}

// ── 이음매 스캔 — 열 단위 휘도 급변이 세로 창 안에서 길게 이어지는가 ──────────
// media = 이미지·캔버스·SVG 사각형 목록. 그 '내부'의 세로 경계선은 그림 내용물이지 레이아웃 결함이 아니라
//   판정에서 뺀다(예: QR 코드는 흑백 단차 덩어리 = Δ150+ 를 십수 개 낸다). 바깥 테두리는 그대로 본다.
function scanSeams(data, W, H, ch, media = []) {
    const inMedia = (x, y0, y1) =>
        media.some(
            (r) => x > r.left && x < r.right - 1 && y1 > r.top + 1 && y0 < r.bottom - 1,
        );
    const lum = (x, y) => {
        const i = (y * W + x) * ch;
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    const hits = [];
    for (let y0 = 0; y0 + SEAM.WIN <= H; y0 += SEAM.STRIDE) {
        for (let x = SEAM.EDGE; x < W - 1 - SEAM.EDGE; x++) {
            let up = 0, dn = 0, sum = 0;
            for (let y = y0; y < y0 + SEAM.WIN; y++) {
                const d = lum(x + 1, y) - lum(x, y);
                if (d > SEAM.T) up++;
                else if (d < -SEAM.T) dn++;
                sum += d;
            }
            const agree = Math.max(up, dn) / SEAM.WIN;
            // 같은 '방향'으로 임계를 넘는 행이 대다수 = 세로로 이어진 경계선(글자·그레인은 방향이 흩어져 탈락)
            if (agree >= SEAM.AGREE && !inMedia(x, y0, y0 + SEAM.WIN)) {
                hits.push({ x, y0, y1: y0 + SEAM.WIN, agree, delta: sum / SEAM.WIN });
            }
        }
    }
    // 같은 x는 세로로 인접한 창끼리 병합(하나의 이음매로 보고)
    const merged = [];
    for (const h of hits.sort((a, b) => a.x - b.x || a.y0 - b.y0)) {
        const last = merged[merged.length - 1];
        if (last && last.x === h.x && h.y0 <= last.y1) {
            last.y1 = Math.max(last.y1, h.y1);
            last.agree = Math.max(last.agree, h.agree);
            if (Math.abs(h.delta) > Math.abs(last.delta)) last.delta = h.delta;
        } else merged.push({ ...h });
    }
    // 좌우 '영역' 밝기 대조 → 단차(step) / 얇은 선(line) 분류
    const side = (x0, x1, y0, y1) => {
        let s = 0, n = 0;
        for (let y = y0; y < y1; y++)
            for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
                s += lum(x, y);
                n++;
            }
        return n ? s / n : NaN;
    };
    for (const m of merged) {
        const L = side(m.x - SEAM.SIDE_GAP - SEAM.SIDE_SPAN, m.x - SEAM.SIDE_GAP + 1, m.y0, m.y1);
        const R = side(m.x + 1 + SEAM.SIDE_GAP, m.x + 1 + SEAM.SIDE_GAP + SEAM.SIDE_SPAN, m.y0, m.y1);
        m.side = isFinite(L) && isFinite(R) ? R - L : 0;
        m.kind = Math.abs(m.side) >= SEAM.STEP_T ? "step" : "line";
    }
    return merged;
}

// ── 본체 ──────────────────────────────────────────────────────────────────────
let chromium, sharp;
try {
    ({ chromium } = await import("playwright-core"));
    sharp = (await import("sharp")).default;
} catch (e) {
    die(2, `[뷰포트감사] 의존 모듈 결측 — npm install 후 다시 실행하세요.\n  ${e.message}`);
}
const exe = findChromium();
if (!exe)
    die(
        2,
        "[뷰포트감사] Chromium 실행파일을 못 찾았습니다.\n  해결: CHROME_PATH=/경로/chrome npm run audit:viewport",
    );
if (!URL_IN && !fs.existsSync(path.join(DIST, "index.html")))
    die(2, "[뷰포트감사] dist/index.html 없음 — 먼저 `npm run build` 하세요.");

const served = URL_IN ? null : await serve(DIST);
const base = URL_IN || `http://127.0.0.1:${served.port}/`;
const browser = await chromium.launch({
    executablePath: exe,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});

// 1) 미디어쿼리 실측 — 페이지가 실제로 선언한 브레이크포인트만 쓴다(임의 창작 금지)
const probe = await browser.newPage({ viewport: { width: 800, height: 600 } });
const jsErrors = [];
probe.on("pageerror", (e) => jsErrors.push(String(e)));
await probe.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
const bps = await probe.evaluate(() => {
    const out = new Set();
    for (const ss of document.styleSheets) {
        let rules;
        try {
            rules = ss.cssRules;
        } catch {
            continue; // 교차출처 스타일시트 = 열람 불가(건너뜀)
        }
        const walk = (rs) => {
            for (const r of rs) {
                if (r.media && r.conditionText) {
                    for (const m of r.conditionText.matchAll(/(\d+(?:\.\d+)?)px/g))
                        out.add(Math.round(+m[1]));
                }
                if (r.cssRules) walk(r.cssRules);
            }
        };
        walk(rules);
    }
    // 컨테이너 max-width도 사실상 브레이크포인트(=기둥 폭) — 260805 결함의 실제 경계였다
    for (const el of document.querySelectorAll("body *")) {
        const mw = getComputedStyle(el).maxWidth;
        if (/^\d+px$/.test(mw)) out.add(parseInt(mw, 10));
    }
    return [...out];
});
await probe.close();
const widths = WIDTHS_IN
    ? WIDTHS_IN.split(",").map((s) => parseInt(s.trim(), 10))
    : buildLadder(bps);

console.log(`[뷰포트감사] 대상 ${base}`);
console.log(`[뷰포트감사] 실측 브레이크포인트: ${bps.sort((a, b) => a - b).join(", ")}`);
console.log(`[뷰포트감사] 폭 사다리(${widths.length}): ${widths.join(", ")}`);

// 2) 폭별 실렌더 + 측정
const rows = [];
for (const w of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: BAND } });
    page.on("pageerror", (e) => jsErrors.push(`${w}px: ${e}`));
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200); // 폰트·셰이더 첫 페인트 안정화
    const m = await page.evaluate(() => {
        const de = document.documentElement;
        const vw = de.clientWidth;
        const over = [];
        for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right > vw + 0.5 || r.left < -0.5) {
                const cs = getComputedStyle(el);
                if (cs.position === "fixed") continue; // 뷰포트 고정층은 문서 폭에 기여하지 않음
                over.push(
                    `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${
                        el.className && typeof el.className === "string"
                            ? "." + el.className.trim().split(/\s+/)[0]
                            : ""
                    } [${Math.round(r.left)}~${Math.round(r.right)}]`,
                );
            }
        }
        // 판정 제외 영역 — '내부'의 세로 경계선이 레이아웃이 아니라 콘텐츠인 곳.
        //  ⓐ 이미지·캔버스·SVG (QR 코드 = Δ150+ 단차를 십수 개 낸다 · #wavebg 배경은 화면 전체라 제외 안 함)
        //  ⓑ 글자 줄상자 (히어로 72px 대문자는 세로 획이 스캔 창보다 길어 '단차'로 잡힌다)
        //     — 블록 전체가 아니라 Range 줄상자 = 글자에 딱 붙는 사각형만 뺀다(주변 배경은 계속 본다)
        const media = [];
        const push = (r) => {
            if (r.width > 2 && r.height > 2)
                media.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        };
        for (const el of document.querySelectorAll("img, svg, canvas, video")) {
            if (el.id === "wavebg") continue;
            push(el.getBoundingClientRect());
        }
        const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            if (!n.nodeValue.trim()) continue;
            const rg = document.createRange();
            rg.selectNodeContents(n);
            for (const r of rg.getClientRects()) push(r);
        }
        return {
            vw,
            hOverflow: de.scrollWidth - de.clientWidth,
            culprits: [...new Set(over)].slice(0, 5),
            media,
        };
    });
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: BAND } });
    await page.close();

    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    // 보고서 임베드는 WebP(무손실 PNG 대비 대폭 감량 · 판정은 위 원본 raw 픽셀로 이미 끝났다)
    const shot = (await sharp(png).webp({ quality: 82 }).toBuffer()).toString("base64");
    const all = scanSeams(data, info.width, info.height, info.channels, m.media);
    const seams = all.filter((s) => s.kind === "step"); // 주목 대상 = 단차만
    const lines = all.length - seams.length; // 얇은 선 = 정상 경계로 간주(카운트만)
    const { media: _m, ...meas } = m;
    rows.push({ w, ...meas, seams, lines, img: shot });
    const flag = m.hOverflow > 0 ? "✗ 오버플로" : seams.length ? `⚠ 단차 ${seams.length}` : "✓";
    console.log(`  ${String(w).padStart(4)}px  ${flag}${lines ? `  (선 ${lines})` : ""}`);
}
await browser.close();
if (served) served.srv.close();

// 3) 보고서 — 디자인 = 260702 리포트 CSS 계승(신설 0)
const esc = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const hardFail = rows.filter((r) => r.hOverflow > 0);
const seamRows = rows.filter((r) => r.seams.length);
const tag = (r) =>
    r.hOverflow > 0
        ? '<span class="tag t-crit">오버플로</span>'
        : r.seams.length
          ? '<span class="tag t-warn">단차 ' + r.seams.length + "</span>"
          : '<span class="tag t-ok">통과</span>';

const html = `<meta name="color-scheme" content="dark">
<title>뷰포트 폭 감사 · ${yymmdd()}</title>
<style>
  :root{
    --bg:#0b0d0c; --card:rgba(38,64,46,.30); --card2:rgba(14,26,18,.55);
    --line:rgba(255,255,255,.10); --accent:#0FFD02; --accent-2:#ff9614;
    --danger:#ff5b4a; --warn:#ffd24a; --info:#0cd0f7;
    --fg:#eef7f0; --fg2:#cfd8d0; --mut:#8fa697; --on-accent:#062108;
    --font:'Pretendard Variable',-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
    --r:16px; --r-s:9px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--fg);font-family:var(--font);line-height:1.6;letter-spacing:-.2px;
    -webkit-font-smoothing:antialiased;padding:32px 18px 80px}
  .wrap{max-width:940px;margin:0 auto}
  h1{font-size:26px;font-weight:800;letter-spacing:-.5px;text-wrap:balance;margin-bottom:6px}
  h1 .hl{color:var(--accent)}
  .sub{color:var(--mut);font-size:14px;margin-bottom:28px}
  h2{font-size:19px;font-weight:800;margin:34px 0 14px;display:flex;align-items:center;gap:9px}
  h2::before{content:"";width:4px;height:19px;border-radius:2px;background:var(--accent);display:block}
  h3{font-size:15px;font-weight:700;margin:18px 0 8px;color:var(--fg2)}
  p{color:var(--fg2);font-size:14.5px;margin-bottom:10px;text-wrap:pretty}
  .card{background:linear-gradient(150deg,var(--card),var(--card2));border:1px solid var(--line);
    border-radius:var(--r);padding:18px 20px;margin:14px 0;
    box-shadow:0 16px 36px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.06)}
  table{width:100%;border-collapse:collapse;font-size:13.5px;margin:8px 0}
  th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--mut);font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td.k{color:var(--fg);font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
  .tag{display:inline-block;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;letter-spacing:.02em}
  .t-crit{background:rgba(255,91,74,.16);color:var(--danger);border:1px solid rgba(255,91,74,.4)}
  .t-warn{background:rgba(255,210,74,.14);color:var(--warn);border:1px solid rgba(255,210,74,.35)}
  .t-ok{background:rgba(15,253,2,.14);color:var(--accent);border:1px solid rgba(15,253,2,.35)}
  .t-info{background:rgba(12,208,247,.13);color:var(--info);border:1px solid rgba(12,208,247,.33)}
  ul.plain{list-style:none;font-size:14px}
  ul.plain li{padding:4px 0 4px 18px;position:relative;color:var(--fg2)}
  ul.plain li::before{content:"•";position:absolute;left:2px;color:var(--accent);font-weight:800}
  .metric{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0}
  .metric .m{flex:1;min-width:150px;background:var(--card2);border:1px solid var(--line);border-radius:var(--r-s);padding:13px 15px}
  .metric .m .big{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
  .metric .m .lbl{font-size:12px;color:var(--mut);margin-top:2px}
  .note{font-size:13px;color:var(--mut);border-left:2px solid var(--line);padding-left:12px;margin:10px 0}
  code{background:rgba(255,255,255,.07);padding:1px 6px;border-radius:5px;font-size:12.5px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg)}
  .foot{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:12.5px}
  .shot{position:relative;border:1px solid var(--line);border-radius:var(--r-s);overflow:hidden;line-height:0;margin:8px 0}
  .shot img{width:100%;display:block}
  .shot .mk{position:absolute;top:0;bottom:0;width:0;border-left:2px dashed var(--warn)}
  .shotcap{font-size:12px;color:var(--mut);margin-bottom:2px;font-variant-numeric:tabular-nums}
  @media(max-width:640px){.metric{grid-template-columns:1fr}}
</style>
<div class="wrap">
  <h1><span class="hl">뷰포트 폭</span> 감사 보고</h1>
  <div class="sub">${esc(base)} · ${yymmdd()} · 기계산출물(손편집 금지 — 재생성 = <code>npm run audit:viewport</code>)</div>

  <div class="card">
    <div class="metric">
      <div class="m"><div class="big">${widths.length}</div><div class="lbl">감사한 폭</div></div>
      <div class="m"><div class="big" style="color:${hardFail.length ? "var(--danger)" : "var(--accent)"}">${hardFail.length}</div><div class="lbl">가로 오버플로 (하드 판정)</div></div>
      <div class="m"><div class="big" style="color:${seamRows.length ? "var(--warn)" : "var(--accent)"}">${seamRows.length}</div><div class="lbl">세로 단차 검출 폭 (참고)</div></div>
      <div class="m"><div class="big" style="color:${jsErrors.length ? "var(--danger)" : "var(--accent)"}">${jsErrors.length}</div><div class="lbl">JS 에러</div></div>
    </div>
    <p class="note">하드 판정 = 가로 오버플로만(위양성 0). <b>세로 단차는 참고</b> — 검출한 세로 경계선을 좌우 '영역' 밝기 차로 갈라, 한쪽이 통째로 어두워지는 <b>단차(step)</b>만 주목 대상으로 올리고 카드 테두리 같은 <b>얇은 선(line)</b>은 정상으로 보아 개수만 센다. 단차도 최종 판정은 아래 스샷의 노란 점선 자리를 사람이 보고 한다.</p>
  </div>

  <h2>폭 사다리 판정</h2>
  <div class="card">
    <table>
      <tr><th>폭</th><th>판정</th><th>가로 오버플로</th><th>단차 x좌표(좌우 영역차)</th><th>얇은 선</th><th>넘치는 원소</th></tr>
      ${rows
          .map(
              (r) => `<tr>
        <td class="k">${r.w}px</td>
        <td>${tag(r)}</td>
        <td class="k">${r.hOverflow > 0 ? r.hOverflow + "px" : "0"}</td>
        <td style="font-size:12.5px;color:var(--fg2)">${
            r.seams.length
                ? r.seams.map((s) => `x=${s.x} (Δ${s.side.toFixed(1)})`).join(", ")
                : "—"
        }</td>
        <td class="k" style="color:var(--mut);font-weight:400">${r.lines || "—"}</td>
        <td style="font-size:12px;color:var(--mut)">${r.culprits.length ? esc(r.culprits.join(" / ")) : "—"}</td>
      </tr>`,
          )
          .join("\n      ")}
    </table>
  </div>

  <h2>폭별 실렌더 (상단 ${BAND}px)</h2>
  <div class="card">
    <p class="note">노란 점선 = 검출된 세로 이음매 자리. 이미지 = 자기완결 base64 임베드(외부 요청 0).</p>
    ${rows
        .map(
            (r) => `<div class="shotcap">${r.w}px ${
                r.hOverflow > 0 ? "✗ 오버플로" : r.seams.length ? "⚠ 단차 " + r.seams.length : "✓ 통과"
            }${r.lines ? ` · 얇은 선 ${r.lines}(정상 경계로 간주)` : ""}</div>
    <div class="shot"><img alt="${r.w}px 렌더" src="data:image/webp;base64,${r.img}">${r.seams
        .map((s) => `<div class="mk" style="left:${((s.x + 1) / r.w) * 100}%"></div>`)
        .join("")}</div>`,
        )
        .join("\n    ")}
  </div>

  <h2>판정 기준 (이 실행에 쓰인 값)</h2>
  <div class="card">
    <ul class="plain">
      <li><b>폭 사다리</b> = CSS 미디어쿼리·컨테이너 max-width 실측(${bps.sort((a, b) => a - b).join(", ")}) + 경계 직전(B−1) + <b>구간 중점</b> + 표준 기기폭(360·390·768·1024·1440). 중점이 핵심 — 260805 결함은 480↔768 구간 한가운데(600px대)에 있었고 경계만 봤으면 못 잡는다.</li>
      <li><b>가로 오버플로</b> = <code>scrollWidth − clientWidth &gt; 0</code>. 하드 판정(종료코드 1).</li>
      <li><b>세로 경계선 검출</b> = 인접 열 휘도차 &gt; ${SEAM.T}(0~255)가 세로 ${SEAM.WIN}px 창 안 ${Math.round(SEAM.AGREE * 100)}% 이상 행에서 <b>같은 방향</b>으로 발생. 방향 일치 조건이 글자·필름그레인을 걸러낸다. 좌우 가장자리 ${SEAM.EDGE}px 무시.</li>
      <li><b>단차 / 얇은 선 분류</b> = 검출된 경계선 좌우로 ${SEAM.SIDE_GAP}px 띄운 ${SEAM.SIDE_SPAN}px 영역의 평균 휘도차가 ${SEAM.STEP_T} 이상이면 <b>단차(step · 주목)</b>, 미만이면 <b>얇은 선(line · 정상 경계)</b>. 결함은 한쪽 영역이 통째로 어두워지는 단차로 나타나고, 카드 테두리·아이콘은 양옆이 같은 얇은 선이다.</li>
      <li><b>이미지 내부 제외</b> = <code>img·svg·canvas·video</code> 사각형 <b>내부</b>의 세로 경계선은 그림 내용물이라 판정에서 뺀다(QR 코드 하나가 Δ150+ 단차를 십수 개 낸다). 바깥 테두리는 그대로 본다. 배경 셰이더 <code>#wavebg</code>는 화면 전체라 제외 대상에서 뺀다.</li>
      <li><b>측정 조건</b> = DPR 1(1px = 1 CSS px) · 스크롤바 숨김 · 첫 페인트 후 1.2s 대기 · 캡처 상단 ${BAND}px.</li>
    </ul>
    ${
        jsErrors.length
            ? `<h3>JS 에러</h3><ul class="plain">${jsErrors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
            : ""
    }
  </div>

  <div class="foot">
    수동 실행 전용 — 훅·pre-commit·크론 편입 금지(<code>shared/measure_align.js</code> 헤더 규율 · 훅킷 「루틴 임의 부착 금지」 동축).
    생성기 = <code>scripts/viewport_audit.js</code> · 보고서 디자인 = <code>docs/reports/260702_홈페이지_UIUX개선.html</code> 계승.
  </div>
</div>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, "utf-8");
const rel = path.relative(ROOT, OUT);
console.log(
    `[뷰포트감사] ${hardFail.length ? "✗ 오버플로 " + hardFail.length + "폭" : "✓ 하드 판정 통과"} · 이음매 참고 ${seamRows.length}폭 · JS 에러 ${jsErrors.length}`,
);
console.log(`[뷰포트감사] 보고서 → ${rel}`);
process.exit(hardFail.length ? 1 : 0);
