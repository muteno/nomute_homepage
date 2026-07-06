/* No Mute 홈 서비스워커 — PWA 설치 요건 + 오프라인 폴백.
   정책: 내비게이션(HTML) = network-first(뉴스 피드 신선도 우선 · 실패 시 캐시 폴백) ·
   동일 오리진 정적 자산(assets/fonts 등) = cache-first(성공 응답만 적재).
   외부 오리진(뉴스 이미지·CDN 폰트)은 관여 안 함(오페이크 캐시 비대 방지).
   버전 올리면(activate) 구 캐시 전량 청소. */
const VER = "nomute-home-v1";
const SHELL = [
    "/",
    "/manifest.webmanifest",
    "/assets/logo.png",
    "/assets/icon-192.png",
    "/assets/icon-512.png",
    "/fonts/LEMONMILK-Bold.otf",
];

self.addEventListener("install", (e) => {
    e.waitUntil(
        caches
            .open(VER)
            .then((c) => c.addAll(SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys.filter((k) => k !== VER).map((k) => caches.delete(k)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== location.origin) return; // 외부 오리진 = 브라우저 기본 경로

    // 내비게이션 = network-first(최신 뉴스) → 오프라인이면 마지막 캐시본
    if (req.mode === "navigate") {
        e.respondWith(
            fetch(req)
                .then((res) => {
                    const cp = res.clone();
                    caches.open(VER).then((c) => c.put("/", cp));
                    return res;
                })
                .catch(() => caches.match("/")),
        );
        return;
    }

    // 정적 자산 = cache-first(미스 시 네트워크 → 성공 응답만 적재)
    e.respondWith(
        caches.match(req).then(
            (hit) =>
                hit ||
                fetch(req).then((res) => {
                    if (res.ok) {
                        const cp = res.clone();
                        caches.open(VER).then((c) => c.put(req, cp));
                    }
                    return res;
                }),
        ),
    );
});
