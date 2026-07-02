// 피드 소스 정본 + 카드 편성 — 에디터(nomute-editor scraper/feeds.csv) 소스 체계 이식판.
// 옛 index.astro의 60칸 수동 나열을 폐지: 소스별 큐 → 중복 제거 → 성향 슬롯 라운드로빈으로 자동 편성.
// 죽은 피드는 다른 소스가 채움(= "기사를 불러올 수 없습니다" 빈 카드 0).

import { fetchRss, fillOgImages, type RssItem } from "./rss";

export type Bias = "agency" | "left" | "right" | "culture";

export interface FeedSource {
    publisher: string;
    badge: string; // 카드 배지 라벨(카테고리 또는 LEFT/RIGHT)
    bias: Bias;
    url: string;
}

export interface NewsCard {
    title: string;
    link: string;
    pubIso: string | null;
    imageUrl: string | null;
    publisher: string;
    badge: string;
    bias: Bias;
    batch: number;
}

export const FEED_SOURCES: FeedSource[] = [
    // 통신사(연합·뉴시스) — 카테고리 배지
    { publisher: "연합뉴스", badge: "정치", bias: "agency", url: "https://www.yna.co.kr/rss/politics.xml" },
    { publisher: "연합뉴스", badge: "경제", bias: "agency", url: "https://www.yna.co.kr/rss/economy.xml" },
    { publisher: "연합뉴스", badge: "사회", bias: "agency", url: "https://www.yna.co.kr/rss/society.xml" },
    { publisher: "연합뉴스", badge: "국제", bias: "agency", url: "https://www.yna.co.kr/rss/international.xml" },
    { publisher: "뉴시스", badge: "정치", bias: "agency", url: "https://www.newsis.com/RSS/politics.xml" },
    { publisher: "뉴시스", badge: "경제", bias: "agency", url: "https://www.newsis.com/RSS/economy.xml" },
    { publisher: "뉴시스", badge: "사회", bias: "agency", url: "https://www.newsis.com/RSS/society.xml" },
    { publisher: "뉴시스", badge: "국제", bias: "agency", url: "https://www.newsis.com/RSS/international.xml" },
    // 성향 매체 — LEFT/RIGHT 배지(편향 병치가 편성 의도)
    { publisher: "동아일보", badge: "RIGHT", bias: "right", url: "https://rss.donga.com/total.xml" },
    { publisher: "한국경제", badge: "RIGHT", bias: "right", url: "https://www.hankyung.com/feed/all-news" },
    { publisher: "매일경제", badge: "RIGHT", bias: "right", url: "https://www.mk.co.kr/rss/40300001/" },
    { publisher: "세계일보", badge: "RIGHT", bias: "right", url: "https://www.segye.com/Articles/RSSList/segye_opinion.xml" },
    { publisher: "경향신문", badge: "LEFT", bias: "left", url: "https://www.khan.co.kr/rss/rssdata/total_news.xml" },
    { publisher: "한겨레", badge: "LEFT", bias: "left", url: "https://www.hani.co.kr/rss/" },
    // 문화
    { publisher: "스포츠경향", badge: "문화", bias: "culture", url: "https://sports.khan.co.kr/rss/k-culture" },
];

// 배치 한 판(10칸)의 성향 슬롯 — 옛 편성 의도 유지: 통신사 5 + 우/좌 교차 4 + 문화 1
const SLOT_PATTERN: Bias[] = [
    "agency", "agency", "agency", "agency", "agency",
    "right", "left", "right", "left", "culture",
];
const MAX_BATCH = 6;
// 성향 슬롯 소진 시 슬롯별 대체 순서 — 성향(좌/우) 슬롯은 중립(통신사) 우선으로 채워
// 남은 반대 성향이 증폭돼 보이는 것을 방지(반대편 채움은 최후순위 · 평의회2 F1).
const FALLBACKS: Record<Bias, Bias[]> = {
    agency: ["right", "left", "culture"],
    right: ["agency", "culture", "left"],
    left: ["agency", "culture", "right"],
    culture: ["agency", "right", "left"],
};

interface SourceQueue {
    src: FeedSource;
    items: RssItem[];
    pos: number;
}

function normTitle(title: string): string {
    return title
        .replace(/[\s"'“”‘’「」『』«»—–\[\]()…·.,!?-]/g, "")
        .slice(0, 60);
}

export async function buildCards(): Promise<NewsCard[]> {
    const results = await Promise.allSettled(FEED_SOURCES.map((s) => fetchRss(s.url)));
    const queues: SourceQueue[] = FEED_SOURCES.map((src, i) => {
        const items = results[i].status === "fulfilled" ? [...results[i].value] : [];
        // 최신순 정렬(피드가 이미 최신순이어도 방어적으로 · pubDate 없는 건 원래 순서 유지)
        items.sort((a, b) => {
            if (!a.pubIso || !b.pubIso) return 0;
            return b.pubIso.localeCompare(a.pubIso);
        });
        return { src, items, pos: 0 };
    });

    const byBias = new Map<Bias, SourceQueue[]>();
    for (const q of queues) {
        if (!byBias.has(q.src.bias)) byBias.set(q.src.bias, []);
        byBias.get(q.src.bias)!.push(q);
    }
    const cursors = new Map<Bias, number>();

    const seenLink = new Set<string>();
    const seenTitle = new Set<string>();

    function popFrom(bias: Bias): { src: FeedSource; item: RssItem } | null {
        const pool = byBias.get(bias);
        if (!pool || pool.length === 0) return null;
        const start = cursors.get(bias) ?? 0;
        for (let n = 0; n < pool.length; n++) {
            const q = pool[(start + n) % pool.length];
            while (q.pos < q.items.length) {
                const item = q.items[q.pos++];
                const tkey = normTitle(item.title);
                if (seenLink.has(item.link) || seenTitle.has(tkey)) continue;
                seenLink.add(item.link);
                seenTitle.add(tkey);
                cursors.set(bias, (start + n + 1) % pool.length);
                return { src: q.src, item };
            }
        }
        return null;
    }

    const cards: NewsCard[] = [];
    for (let batch = 1; batch <= MAX_BATCH; batch++) {
        for (const bias of SLOT_PATTERN) {
            let pick = popFrom(bias);
            if (!pick) {
                for (const fb of FALLBACKS[bias]) {
                    pick = popFrom(fb);
                    if (pick) break;
                }
            }
            if (!pick) continue; // 전 소스 고갈 — 그 칸은 건너뜀
            cards.push({
                title: pick.item.title,
                link: pick.item.link,
                pubIso: pick.item.pubIso,
                imageUrl: pick.item.imageUrl,
                publisher: pick.src.publisher,
                badge: pick.src.badge,
                bias: pick.src.bias,
                batch,
            });
        }
    }

    await fillOgImages(cards);
    return cards;
}
