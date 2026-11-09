const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function withPage(fn, { locale = 'ko-KR' } = {}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: UA, locale, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

// 페이지를 여는 동안 오는 JSON 응답을 모두 모은다.
// 사이트 내부 API 주소가 바뀌어도 화면이 쓰는 데이터를 그대로 잡을 수 있게 하기 위함.
function captureJson(page, urlFilter = () => true) {
  const captured = [];
  page.on('response', async res => {
    try {
      const url = res.url();
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json') || !urlFilter(url)) return;
      captured.push({ url, status: res.status(), body: await res.json() });
    } catch { /* 본문이 없거나 JSON 이 아니면 무시 */ }
  });
  return captured;
}

// JSON 안에서 "상품 목록처럼 생긴" 가장 큰 배열을 찾는다.
const NAME_KEYS  = ['goodsName', 'goodsNm', 'prdtName', 'productName', 'name', 'title', 'itemName'];
const PRICE_KEYS = ['price', 'salePrice', 'finalPrice', 'dcPrice', 'sellPrice', 'normalPrice'];

// 무신사처럼 { id, info: { productName, finalPrice } } 형태로 한 단계 중첩된 경우도 본다
function flatKeys(o) {
  const keys = Object.keys(o);
  for (const k of ['info', 'product', 'goods', 'item']) {
    if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) keys.push(...Object.keys(o[k]));
  }
  return keys.map(k => k.toLowerCase());
}

function looksLikeProduct(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const keys = flatKeys(o);
  const has = list => list.some(k => keys.some(x => x.includes(k.toLowerCase())));
  return has(NAME_KEYS) && has(PRICE_KEYS);
}

function findProductArrays(node, path = '$', out = []) {
  if (Array.isArray(node)) {
    const hits = node.filter(looksLikeProduct).length;
    if (hits >= 5 && hits >= node.length * 0.6) out.push({ path, items: node });
    node.forEach((v, i) => i < 3 && findProductArrays(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) findProductArrays(v, `${path}.${k}`, out);
  }
  return out;
}

// 키 후보 목록에서 첫 번째로 값이 있는 것을 고른다 (중첩 경로 a.b 지원)
function pick(o, candidates) {
  for (const c of candidates) {
    const v = c.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

module.exports = { withPage, captureJson, findProductArrays, pick };
