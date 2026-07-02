// 빌드 시점 RSS 수집·정규화 — 파싱은 기존 index.astro 로직 이관, og:image는 표시분만 뒤에서 채움(fillOgImages).

export interface RssItem {
    title: string;
    link: string;
    pubIso: string | null;
    imageUrl: string | null;
}

const TIMEOUT_FEED = 5000;
const TIMEOUT_OG = 2500;

function cleanStr(str: string | null | undefined): string {
    if (!str) return "";
    const s = str.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/gi, "$1").trim();
    return s
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

function toIso(dateStr: string): string | null {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

// URL 정규화 = 출력 전 필수(평의회9 CRITICAL). Astro 5의 URL 속성 이스케이프 생략 최적화
// + cleanStr 엔티티 역디코딩 조합이 data-link/img src 속성 탈출 저장형 XSS를 만든다.
// new URL().href는 " < > 를 %22/%3C/%3E로 인코딩 → 속성 탈출 불가. https만 통과·사설IP 등은 호출부에서.
export function safeHttpUrl(raw: string): string | null {
    try {
        // 프로토콜-상대(//host/…)는 RSS 이미지에 흔함 → https로 승격(드롭 방지)
        const candidate = raw.startsWith("//") ? "https:" + raw : raw;
        const u = new URL(candidate);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        return u.href;
    } catch {
        return null;
    }
}

function itemImage(itemContent: string): string | null {
    const enc = itemContent.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
    if (enc) return enc[1];
    const mc = itemContent.match(/<media:content[^>]*url=["']([^"']+)["']/i);
    if (mc) return mc[1];
    const mt = itemContent.match(/<media:thumbnail[^>]*url=["']([^"']+)["']/i);
    if (mt) return mt[1];
    const desc = itemContent.match(
        /<(?:description|content:encoded)[^>]*>([\s\S]*?)<\/(?:description|content:encoded)>/i,
    );
    if (desc) {
        const img = desc[1].match(/<img[^>]+src=["']([^"']+)["']/i);
        if (img) return img[1];
    }
    return null;
}

export async function fetchRss(url: string): Promise<RssItem[]> {
    try {
        const res = await fetchWithTimeout(url, TIMEOUT_FEED);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();

        const items: RssItem[] = [];
        const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
        let match: RegExpExecArray | null;
        while ((match = itemRegex.exec(xml)) !== null) {
            const itemContent = match[1];
            const titleMatch = itemContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const linkMatch = itemContent.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            const pubMatch =
                itemContent.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
                itemContent.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i);

            const title = titleMatch ? cleanStr(titleMatch[1]) : "";
            let link = linkMatch ? cleanStr(linkMatch[1]) : "";
            // Atom형 자기폐쇄 <link href="..."/> 폴백(평의회1 F1 — 소스 통째 0건 방지)
            if (!/^https?:\/\//.test(link)) {
                const hrefMatch = itemContent.match(/<link[^>]*href=["']([^"']+)["']/i);
                if (hrefMatch) link = cleanStr(hrefMatch[1]);
            }
            const safeLink = safeHttpUrl(link);
            if (!title || !safeLink) continue;

            const rawImg = itemImage(itemContent)?.replace(/&amp;/g, "&");
            items.push({
                title,
                link: safeLink,
                pubIso: pubMatch ? toIso(cleanStr(pubMatch[1])) : null,
                imageUrl: rawImg ? safeHttpUrl(rawImg) : null,
            });
        }
        return items;
    } catch (error) {
        console.error("RSS Fetch Error for", url, (error as Error).message);
        return [];
    }
}

// 사설/루프백/링크로컬/메타데이터 호스트 차단(평의회9 빌드 SSRF 방어)
function isPrivateHost(host: string): boolean {
    const h = host.toLowerCase();
    if (h === "localhost" || h === "::1" || h.endsWith(".local")) return true;
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 169 && b === 254) return true; // link-local(169.254.169.254 메타데이터)
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
    }
    return false;
}

async function fetchOgImage(linkUrl: string): Promise<string | null> {
    try {
        const u = new URL(linkUrl);
        if (u.protocol !== "https:" && u.protocol !== "http:") return null;
        if (isPrivateHost(u.hostname)) return null;
        const res = await fetchWithTimeout(linkUrl, TIMEOUT_OG);
        if (!res.ok) return null;
        const text = await res.text();
        const ogMatch =
            text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i) ||
            text.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);
        return ogMatch ? safeHttpUrl(ogMatch[1].replace(/&amp;/g, "&")) : null;
    } catch {
        return null;
    }
}

// og:image 폴백 — 화면에 실제로 나가는 카드에만·동시 6개 제한(빌드 시간 폭주 방지: 옛 코드는 전 아이템 순차 fetch였음)
export async function fillOgImages(
    items: Array<{ link: string; imageUrl: string | null }>,
    concurrency = 6,
): Promise<void> {
    const targets = items.filter((it) => !it.imageUrl && it.link);
    let cursor = 0;
    async function worker() {
        while (cursor < targets.length) {
            const item = targets[cursor++];
            item.imageUrl = await fetchOgImage(item.link);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
}
