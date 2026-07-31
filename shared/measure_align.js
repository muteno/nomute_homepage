#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// measure_align.js — [픽셀실측](CLAUDE.md 공통 조항) 상비 측정기 (운영자 260731 "한수까지 적용" 채택)
//
// 무엇: 정렬 있는 디자인(픽토그램·버튼·아이콘·텍스트 필)의 두 축을 실렌더에서 기계 측정 —
//   ① 기하 = 내부 픽토(svg/img/첫 자식) 중심 vs 컨테이너 4분할 중앙점 + 대상들끼리 세로 정렬선 Δ
//   ② 광학(잉크) = DPR3 캡처 픽셀 스캔으로 실제 그려진 잉크의 무게중심 vs 컨테이너 중심(참고 로그)
//   + 중심 십자선 오버레이 캡처(빨강 = 컨테이너 · 초록 = 픽토) = [전후] 증빙용.
//
// 왜 잉크는 참고인가(정직): 픽토그램은 도형 자체가 비대칭(연필 대각선·화살표 등)이라 잉크 무게중심이
//   기하 중심과 다른 게 '정상'인 경우가 많다 — 하드 판정은 기하 축만(Δ≤0.67 = 기틀 0.5 + DPR3 양자화
//   반스텝 · smoke_rank BAR 동값). 텍스트 필처럼 잉크 정렬이 목표인 표면은 --ink-gate로 잉크도 하드 판정
//   (그 축의 상비 전문기는 smoke_rank.js — 정수 스테이지 격리 방식이 더 정밀 · 본 도구는 라이브 배치 범용).
//
// 사용(수동 실행 전용 · 훅·pre-commit 편입 금지 = CLAUDE.md [15] 축 동일):
//   node shared/measure_align.js <페이지.html> <셀렉터> [셀렉터…] [옵션]
//   예) node shared/measure_align.js ly.html '#lyReburn' '#lyOvlDl' '#lyBurnDl' \
//         --prep "lyBurn.hidden=false;lyReburn.hidden=false;lyOvlDl.hidden=false;lyOvlDl.innerHTML=LAYERS_SVG;lyBurnDl.hidden=false;lyBurnDl.innerHTML=DOWNLOAD_SVG" \
//         --out /tmp/align.png
//   옵션: --prep "<js>"       측정 전 페이지에서 실행할 준비 JS(숨김 해제·아이콘 주입 등 · 라이브 코드 무접촉)
//         --out <png>         십자선 캡처 저장 경로(기본 /tmp/measure_align.png)
//         --viewport WxH      뷰포트(기본 420x900)
//         --ink bright|dark   잉크 판정 모드(기본 bright = 어두운 배경 위 밝은 잉크)
//         --ink-gate          잉크 Δ도 하드 판정에 포함(텍스트 필용)
//         --root <디렉토리>    정적 서빙 루트(운영자 260731 한수 — 4레포 공용 이식용) · 결측 = viewer/ 있으면 viewer/ · 없으면 레포 루트
//   종료코드: 0 = 전 대상 기하 |Δ| ≤ 0.67(+옵션 시 잉크) · 1 = 초과/대상 미발견.
//
// 문법 계승: 서버·브라우저 부팅 = smoke_rank.js(포트만 8816~8820 분리) · DPR3 캡처 · 인페이지 캔버스
//   잉크 프로브. 스크린샷 베이스라인 diff 금지([15]) — 동일 런 내 수치 판정만.
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const BAR = 0.67;   // 기틀 [픽셀실측] 0.5 + DPR3 양자화 반스텝(≈0.17) — smoke_rank 동값

function loadPlaywright() {
  try { return require('playwright-core'); } catch (_) {}
  const cache = path.join(os.tmpdir(), 'nomute-smoke-deps');
  const mod = path.join(cache, 'node_modules', 'playwright-core');
  if (!fs.existsSync(mod)) {
    console.log('· playwright-core 미설치 → 임시 캐시 설치(1회): ' + cache);
    fs.mkdirSync(cache, { recursive: true });
    execSync('npm i --prefix "' + cache + '" playwright-core --no-audit --no-fund --loglevel=error', { stdio: 'inherit' });
  }
  return require(mod);
}
function chromiumPath() {
  const cands = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'];
  try { cands.push(execSync('which chromium chromium-browser google-chrome 2>/dev/null | head -1').toString().trim()); } catch (_) {}
  return cands.find(Boolean);
}
async function startServer(rootDir) {
  for (const port of [8816, 8817, 8818, 8819, 8820]) {   // smoke_* 대역과 분리
    const srv = spawn('python3', ['-m', 'http.server', String(port), '-d', rootDir], { stdio: 'ignore' });
    const ok = await new Promise(res => {
      let done = false;
      srv.on('exit', () => { if (!done) { done = true; res(false); } });
      setTimeout(async () => {
        if (done) return;
        try { const r = await fetch('http://127.0.0.1:' + port + '/', { method: 'HEAD' }); done = true; res(r.ok); }   // 프로브 = 루트(디렉토리 목록 200) — index.html 없는 레포도 통과(--root 이식 260731)
        catch (_) { done = true; try { srv.kill(); } catch (e) {} res(false); }
      }, 700);
    });
    if (ok) return { srv, port };
    try { srv.kill(); } catch (_) {}
  }
  throw new Error('정적 서버 기동 실패(8816~8820 전부 불가)');
}

function parseArgs(argv) {
  const a = { sels: [], out: '/tmp/measure_align.png', viewport: [420, 900], ink: 'bright', inkGate: false, prep: '', root: '' };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i];
    if (v === '--prep') a.prep = rest[++i] || '';
    else if (v === '--root') a.root = rest[++i] || '';
    else if (v === '--out') a.out = rest[++i] || a.out;
    else if (v === '--viewport') { const m = /^(\d+)x(\d+)$/.exec(rest[++i] || ''); if (m) a.viewport = [+m[1], +m[2]]; }
    else if (v === '--ink') a.ink = (rest[++i] === 'dark') ? 'dark' : 'bright';
    else if (v === '--ink-gate') a.inkGate = true;
    else if (!a.page) a.page = v;
    else a.sels.push(v);
  }
  return a;
}

(async () => {
  const A = parseArgs(process.argv);
  if (!A.page || !A.sels.length) {
    console.log('사용: node shared/measure_align.js <페이지.html> <셀렉터> [셀렉터…] [--prep js] [--out png] [--viewport WxH] [--ink bright|dark] [--ink-gate] [--root 디렉토리]');
    process.exit(1);
  }
  const pw = loadPlaywright();
  // 서빙 루트: --root 명시 > viewer/(노뮤트 계열 기본) > 레포 루트 — 4레포 공용 원본 이식(개조 0 · 운영자 260731 한수)
  const rootDir = A.root ? path.resolve(process.cwd(), A.root)
    : (fs.existsSync(path.join(ROOT, 'viewer')) ? path.join(ROOT, 'viewer') : ROOT);
  if (!fs.existsSync(rootDir)) { console.log('FAIL | --root 디렉토리 없음: ' + rootDir); process.exit(1); }
  const { srv, port } = await startServer(rootDir);
  let rc = 0;
  const browser = await pw.chromium.launch({ executablePath: chromiumPath() });
  try {
    const pg = await browser.newPage({ viewport: { width: A.viewport[0], height: A.viewport[1] }, deviceScaleFactor: 3 });
    const errs = [];
    pg.on('pageerror', e => errs.push(String(e)));
    await pg.goto('http://127.0.0.1:' + port + '/' + A.page.replace(/^\/+/, ''), { waitUntil: 'load' });
    if (A.prep) await pg.evaluate(A.prep);
    await pg.waitForTimeout(150);
    await pg.evaluate(() => document.fonts && document.fonts.ready);

    // 기하 = 전 대상 일괄 선측정(단일 스냅샷) — 아래 잉크 캡처가 요소를 자동 스크롤해 좌표계를 옮기므로
    //   대상별 순차 측정은 정렬선Δ에 스크롤 델타가 오염된다(260731 실측 -306px 허위 FAIL → 선측정으로 봉합).
    const geos = await pg.evaluate(sels => sels.map(s => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const kid = el.querySelector('svg,img') || el.firstElementChild;
      const kr = kid ? kid.getBoundingClientRect() : null;
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2,
               kid: kr ? { cx: kr.x + kr.width / 2, cy: kr.y + kr.height / 2, x: kr.x, y: kr.y, w: kr.width, h: kr.height } : null };
    }), A.sels);
    const rows = [];
    for (let si = 0; si < A.sels.length; si++) {
      const sel = A.sels[si];
      const geo = geos[si];
      if (!geo) { console.log('FAIL | ' + sel + ' | 대상 미발견'); rc = 1; continue; }
      // 광학(잉크) — 대상 단독 캡처(DPR3) → 인페이지 캔버스 무게중심
      let inkD = null;
      try {
        const h = await pg.$(sel);
        const buf = await h.screenshot();
        inkD = await pg.evaluate(async ({ b64, mode, w, h2 }) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + b64;
          await new Promise(r => { img.onload = r; });
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          const cx2 = cv.getContext('2d');
          cx2.drawImage(img, 0, 0);
          const d = cx2.getImageData(0, 0, cv.width, cv.height).data;
          let sx = 0, sy = 0, n = 0;
          for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
            const i = (y * cv.width + x) * 4;
            const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            const ink = mode === 'dark' ? (lum < 70 && d[i + 3] > 16) : (lum > 110 && d[i + 3] > 16);
            if (ink) { sx += x; sy += y; n++; }
          }
          if (!n) return null;
          const k = img.width / w;   // DPR 환산(캡처px → CSS px)
          return { dx: (sx / n + 0.5) / k - w / 2, dy: (sy / n + 0.5) / k - h2 / 2, n };
        }, { b64: buf.toString('base64'), mode: A.ink, w: geo.w, h2: geo.h });
      } catch (e) { /* 잉크 프로브 실패 = 참고 축이라 판정 비영향(기하는 이미 확보) */ }
      rows.push({ sel, geo, inkD });
    }

    // 판정 — 기하: 픽토 중심 = 컨테이너 4분할 중심 · 대상 간 세로 정렬선(첫 대상 기준)
    const baseCy = rows.length ? rows[0].geo.cy : 0;
    for (const r of rows) {
      const g = r.geo;
      const kd = g.kid ? { dx: +(g.kid.cx - g.cx).toFixed(2), dy: +(g.kid.cy - g.cy).toFixed(2) } : null;
      const rowDy = +(g.cy - baseCy).toFixed(2);
      const geoBad = (kd && (Math.abs(kd.dx) > BAR || Math.abs(kd.dy) > BAR)) || Math.abs(rowDy) > BAR;
      const inkTx = r.inkD ? ('잉크Δ ' + (+r.inkD.dx.toFixed(2)) + '/' + (+r.inkD.dy.toFixed(2)) + (A.inkGate ? '' : ' [참고]')) : '잉크 미검출';
      const inkBad = A.inkGate && r.inkD && (Math.abs(r.inkD.dx) > BAR || Math.abs(r.inkD.dy) > BAR);
      if (geoBad || inkBad) rc = 1;
      console.log((geoBad || inkBad ? 'FAIL' : 'PASS') + ' | ' + r.sel
        + ' | 픽토Δ ' + (kd ? kd.dx + '/' + kd.dy : '자식 없음')
        + ' · 정렬선Δ ' + rowDy + ' · 박스 ' + (+g.w.toFixed(1)) + 'x' + (+g.h.toFixed(1))
        + ' · ' + inkTx);
    }
    if (errs.length) { console.log('FAIL | 페이지 에러 ' + errs.length + '건 | ' + errs[0].slice(0, 120)); rc = 1; }

    // 십자선 캡처(증빙) — 빨강 = 컨테이너 중심 · 초록 = 픽토 중심
    if (rows.length) {
      // 십자선·클립은 **캡처 시점의 좌표**로 재계산 — 잉크 캡처가 스크롤을 옮겨 선측정 좌표는 캡처엔 부적격(260731 실측: 옛 좌표 클립 = 빈 영역 예외)
      const bb = await pg.evaluate(sels => {
        const first = sels.map(s => document.querySelector(s)).find(Boolean);
        if (first) first.scrollIntoView({ block: 'center' });
        const mk = (l, t, w, h, col) => { const dv = document.createElement('div');
          dv.style.cssText = 'position:fixed;left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;background:' + col + ';z-index:2147483647;pointer-events:none;';
          dv.dataset.measureCross = '1'; document.body.appendChild(dv); };
        const cross = (r, col) => { mk(r.x + r.width / 2 - 0.5, r.y - 4, 1, r.height + 8, col); mk(r.x - 4, r.y + r.height / 2 - 0.5, r.width + 8, 1, col); };
        const b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
        for (const s of sels) { const el = document.querySelector(s); if (!el) continue;
          const r = el.getBoundingClientRect();
          cross(r, 'rgba(255,80,80,.9)');
          const kid = el.querySelector('svg,img') || el.firstElementChild;
          if (kid) cross(kid.getBoundingClientRect(), 'rgba(80,255,120,.9)');
          b.x0 = Math.min(b.x0, r.x); b.y0 = Math.min(b.y0, r.y); b.x1 = Math.max(b.x1, r.x + r.width); b.y1 = Math.max(b.y1, r.y + r.height); }
        return b;
      }, A.sels);
      if (bb.x1 > bb.x0) {
        await pg.screenshot({ path: A.out, clip: { x: Math.max(0, bb.x0 - 10), y: Math.max(0, bb.y0 - 10), width: bb.x1 - bb.x0 + 20, height: bb.y1 - bb.y0 + 20 } });
        console.log('십자선 캡처: ' + A.out);
      }
    }
  } catch (e) {
    console.log('FAIL | 측정기 예외 | ' + String(e).slice(0, 200));
    rc = 1;
  } finally {
    try { await browser.close(); } catch (_) {}
    try { srv.kill(); } catch (_) {}
  }
  process.exit(rc);
})();
