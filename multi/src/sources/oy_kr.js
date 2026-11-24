// 한국 올리브영 — 기존 트래커와 같은 랭킹(getBestList.do)을 수집한다.
// 기존 트래커 코드/테이블은 건드리지 않고, 같은 방식으로 새 테이블에 따로 누적.
const { parseNum, discountRate, sleep } = require('../lib/util');

const BASE = 'https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&pageIdx=1&rowsPerPage=8&fltDispCatNo=';
const WARMUP_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealList.do';

const categories = [
  { category: 'skincare', label: '스킨케어', code: '10000010001' },
  { category: 'body',     label: '바디케어', code: '10000010003' },
  { category: 'hair',     label: '헤어케어', code: '10000010004' },
  { category: 'makeup',   label: '메이크업', code: '10000010002' },
  { category: 'mask',     label: '마스크팩', code: '10000010009' },
  { category: 'cleanser', label: '클렌징',   code: '10000010010' },
];

async function prepare(page) {
  // getBestList 로 바로 goto 하면 데이터센터 IP 에서 타임아웃 → 다른 페이지로 세션을 연 뒤 내부 fetch (기존 트래커와 동일)
  await page.goto(WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
}

async function scrape(page, cat) {
  const url = BASE + cat.code;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await page.evaluate(async u => {
      const res = await fetch(u, { credentials: 'include' });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      return {
        status: res.status,
        items: Array.from(doc.querySelectorAll('.cate_prd_list li')).map(li => {
          const link = li.querySelector('a.goods_btn_link') || li.querySelector('a');
          return {
            brand:  li.querySelector('.tx_brand')?.textContent.trim() || '',
            name:   li.querySelector('.tx_name')?.textContent.trim() || '',
            sale:   li.querySelector('.tx_cur .tx_num')?.textContent.trim() || '',
            list:   li.querySelector('.tx_org .tx_num')?.textContent.trim() || '',
            url:    link?.href || '',
            image:  li.querySelector('img')?.src || '',
            badges: Array.from(li.querySelectorAll('.icon_flag')).map(b => b.textContent.trim()).filter(Boolean),
            soldOut: !!li.querySelector('.soldout'),
          };
        }),
      };
    }, url);

    const items = result.items.filter(i => i.name);
    if (items.length > 0) {
      await sleep(3000);
      return items.slice(0, 100).map(i => {
        const sale = parseNum(i.sale);
        const list = parseNum(i.list) ?? sale;
        return {
          product_id:    (i.url.match(/goodsNo=([A-Z0-9]+)/) || [])[1] || null,
          brand_name:    i.brand,
          product_name:  i.name,
          currency:      'KRW',
          list_price:    list,
          sale_price:    sale,
          discount_rate: discountRate(list, sale),
          rating:        null,
          review_count:  null,
          product_url:   i.url,
          image_url:     i.image || null,
          badges:        i.soldOut ? [...i.badges, '품절'] : i.badges,
          raw:           null,
        };
      });
    }
    const wait = result.status === 429 ? attempt * 10000 : attempt * 4000;
    console.log(`  ⚠️  빈 목록(status=${result.status}), ${wait / 1000}초 후 재시도`);
    await sleep(wait);
  }
  return [];
}

module.exports = { platform: 'oy_kr', categories, prepare, scrape };
