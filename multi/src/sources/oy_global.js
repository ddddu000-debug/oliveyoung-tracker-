// 올리브영 글로벌 — Best Seller 페이지의 "Top Orders" 탭
// 카테고리 라벨/응답 구조는 `npm run discover -- oy_global` 결과로 확정한다.
const { captureJson } = require('../lib/browser');
const { scrapeByClick } = require('./clickcapture');
const { mapItem } = require('./generic');

const PAGE_URL = 'https://global.oliveyoung.com/display/page/best-seller?target=pillsTab1Nav1';
const TOP_ORDERS_PANEL = '#pillsTab1Cont1';

const categories = [
  { category: 'skincare', label: 'Skincare',  labelRe: /^\s*skin\s*care\s*$/i },
  { category: 'body',     label: 'Body',      labelRe: /^\s*body(\s*care)?\s*$/i },
  { category: 'mask',     label: 'Face Mask', labelRe: /^\s*(face\s*)?masks?(\s*pack)?\s*$/i },
];

let captured;

async function prepare(page) {
  captured = captureJson(page, u => u.includes('oliveyoung.com'));
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4000);
}

async function scrape(page, cat) {
  const { items, sources } = await scrapeByClick(page, captured, { scope: TOP_ORDERS_PANEL, labelRe: cat.labelRe });
  console.log(`  응답 출처: ${sources.join(', ') || '(없음)'}`);
  return items.slice(0, 100).map(o => mapItem(o, {
    currency: 'USD',
    urlFor: id => `https://global.oliveyoung.com/product/detail?prdtNo=${id}`,
  }));
}

module.exports = { platform: 'oy_global', categories, prepare, scrape, PAGE_URL };
