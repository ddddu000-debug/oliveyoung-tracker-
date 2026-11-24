// 올리브영 글로벌 — Best Seller 페이지 "Top Orders" 탭이 쓰는 order-best API 를 호출한다.
// 카테고리별로 100위까지 한 번에 온다. 가격은 USD, 배송국가 코드는 페이지 기본값(20)을 따른다.
const { fetchJson } = require('../lib/browser');
const { parseNum, discountRate, sleep } = require('../lib/util');

const PAGE_URL = 'https://global.oliveyoung.com/display/page/best-seller?target=pillsTab1Nav1';
const API = 'https://global.oliveyoung.com/display/product/best-seller/order-best'
  + '?acesCntryCode=00&previewDate=&encKey=&encText=&accParam=&dispPageTypeCode=30&langCode=en&dispPageNo='
  + '&mrgnCntryCode=20&dlvCntryCode=20&isGlobal=false&showSoldoutProduct=true&ctgrNo=';

// ctgrNo 는 best-seller-data API 의 ctgrList 로 확인 (2026-11-09)
const categories = [
  { category: 'skincare', label: 'Skincare',    code: '1000000008' },
  { category: 'body',     label: 'Bath & Body', code: '1000000052' },
  { category: 'mask',     label: 'Face Masks',  code: '1000000003' },
];

const FLAGS = { bestYn: 'BEST', newYn: 'NEW', flashYn: 'FLASH', cpnYn: 'COUPON', giftYn: 'GIFT', soldOutYn: 'SOLD OUT' };

async function prepare(page) {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
}

async function scrape(page, cat) {
  const list = await fetchJson(page, API + cat.code);
  if (!Array.isArray(list)) throw new Error('order-best 응답이 배열이 아님');
  await sleep(2000);

  return list.slice(0, 100).map(p => {
    const sale = parseNum(p.saleAmt);
    const nrml = parseNum(p.nrmlAmt) ?? sale;
    const rate = parseNum(p.eventSlprcDscntRt);
    return {
      product_id:    p.prdtNo,
      brand_name:    p.brandName,
      product_name:  p.prdtName,
      currency:      'USD',
      list_price:    nrml,
      sale_price:    sale,
      discount_rate: rate != null ? Math.round(rate * 10) / 1000 : discountRate(nrml, sale),
      rating:        parseNum(p.avgScore),
      review_count:  parseNum(p.reviewCnt),
      product_url:   `https://global.oliveyoung.com/product/detail?prdtNo=${p.prdtNo}`,
      image_url:     null,   // imagePath 는 상대경로라 raw 에만 보관
      badges:        Object.entries(FLAGS).filter(([k]) => p[k] === 'Y').map(([, v]) => v),
      raw:           Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== '')),
    };
  });
}

module.exports = { platform: 'oy_global', categories, prepare, scrape };
