// 무신사 뷰티 랭킹 — 랭킹 페이지(/main/beauty/ranking)가 쓰는 API 를 그대로 호출한다.
// period=DAILY(일간 랭킹), 성별 전체(gf=A), 연령 전체. 1페이지에 102위까지 온다.
const { fetchJson } = require('../lib/browser');
const { parseNum, discountRate, sleep } = require('../lib/util');

const PAGE_URL = 'https://www.musinsa.com/main/beauty/ranking';
const API = 'https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/231'
  + '?storeCode=beauty&gf=A&ageBand=AGE_BAND_ALL&period=DAILY&contentsId=&subPan=product&page=1&categoryCode=';

// 카테고리 코드는 랭킹 페이지 탭 클릭으로 확인 (2026-11-09)
const categories = [
  { category: 'skincare', label: '스킨케어',     code: '104001' },
  { category: 'mask',     label: '마스크팩',     code: '104013' },
  { category: 'cleanser', label: '클렌징/필링',  code: '104003' },
];

async function prepare(page) {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
}

async function scrape(page, cat) {
  const json = await fetchJson(page, API + cat.code);
  const cols = [];
  (json?.data?.modules || []).forEach(m => (m.items || []).forEach(i => i.type === 'PRODUCT_COLUMN' && cols.push(i)));
  await sleep(2000);

  return cols
    .sort((a, b) => (a.image?.rank ?? 999) - (b.image?.rank ?? 999))
    .slice(0, 100)
    .map(i => {
      const ga  = i.image?.onClickLike?.eventLog?.ga4?.payload || {};
      const amp = i.image?.onClickLike?.eventLog?.amplitude?.payload || {};
      const sale = parseNum(i.info?.finalPrice);
      const list = parseNum(ga.original_price) ?? sale;
      const score = parseNum(amp.reviewScore);   // 0~100 만족도 → 5점 만점으로 환산
      return {
        product_id:    String(i.id),
        brand_name:    i.info?.brandName || amp.brand_name || null,
        product_name:  i.info?.productName || amp.product_name || null,
        currency:      'KRW',
        list_price:    list,
        sale_price:    sale,
        discount_rate: i.info?.discountRatio != null ? i.info.discountRatio / 100 : discountRate(list, sale),
        rating:        score != null ? Math.round(score / 2) / 10 : null,
        review_count:  parseNum(amp.reviewCount),
        product_url:   `https://www.musinsa.com/products/${i.id}`,
        image_url:     i.image?.url || null,
        badges:        (i.image?.labels || []).map(l => l.text).filter(Boolean),
        raw:           { rank: i.image?.rank, info: i.info, ga4: ga, amplitude: amp },
      };
    });
}

module.exports = { platform: 'musinsa', categories, prepare, scrape };
