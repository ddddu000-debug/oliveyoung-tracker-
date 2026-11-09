// 무신사 뷰티 — 랭킹(판매순) 페이지
// 카테고리 라벨/응답 구조는 `npm run discover -- musinsa` 결과로 확정한다.
const { captureJson } = require('../lib/browser');
const { scrapeByClick } = require('./clickcapture');
const { mapItem } = require('./generic');

const PAGE_URL = 'https://www.musinsa.com/main/beauty/ranking';

const categories = [
  { category: 'skincare', label: '스킨케어',   labelRe: /^\s*스킨케어\s*$/ },
  { category: 'mask',     label: '마스크팩',   labelRe: /^\s*마스크\s*팩?\s*$/ },
  { category: 'cleanser', label: '클렌징',     labelRe: /^\s*클렌징(\/필링)?\s*$/ },
];

let captured;

async function prepare(page) {
  captured = captureJson(page, u => u.includes('musinsa.com'));
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
}

async function scrape(page, cat) {
  const { items, sources } = await scrapeByClick(page, captured, { labelRe: cat.labelRe });
  console.log(`  응답 출처: ${sources.join(', ') || '(없음)'}`);
  return items.slice(0, 100).map(o => mapItem(o, {
    currency: 'KRW',
    urlFor: id => `https://www.musinsa.com/products/${id}`,
  }));
}

module.exports = { platform: 'musinsa', categories, prepare, scrape, PAGE_URL };
