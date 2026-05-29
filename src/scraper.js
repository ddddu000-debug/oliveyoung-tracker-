const { chromium } = require('playwright');
require('dotenv').config();

const TARGET_COUNT = 100;
const HOTDEAL_LIST_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealList.do';
const HOTDEAL_AJAX_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealPagingListAjax.do';

function makeRunId() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function parsePrice(str) {
  if (!str) return null;
  const num = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? null : num;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// product_url에서 goodsNo(상품 고유번호) 추출
function extractGoodsNo(url) {
  if (!url) return null;
  const m = url.match(/goodsNo=([A-Z0-9]+)/);
  return m ? m[1] : null;
}

// 오늘의 오특 상품 goodsNo Set 수집
// hotdeal 페이지에서 ajax pagination을 끝까지 돌려 모든 오특 상품의 goodsNo를 모은다
async function fetchTodaysOtukGoodsNos(page) {
  console.log('\n[오특] 오늘의 특가 상품 목록 수집 중...');

  // 세션 쿠키 / Referer 확보를 위해 hotdeal 페이지 먼저 방문
  await page.goto(HOTDEAL_LIST_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // 오늘 날짜 (yyyyMMdd)
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateParam = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;

  const allGoodsNos = new Set();
  const MAX_PAGE = 50;   // 안전 상한 (보통 5페이지 이내)

  for (let pageIdx = 1; pageIdx <= MAX_PAGE; pageIdx++) {
    const url = `${HOTDEAL_AJAX_URL}?date=${dateParam}&pageIdx=${pageIdx}&fltCondition=02&fltDispCatNo=&prdSort=rank`;
    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'include' });
        const text = await res.text();
        return { status: res.status, body: text };
      } catch (e) {
        return { error: e.message };
      }
    }, url);

    if (result.error) {
      console.log(`  ⚠️  pageIdx=${pageIdx} 요청 실패: ${result.error}`);
      break;
    }

    const goodsNos = [...new Set([...result.body.matchAll(/goodsNo=([A-Z0-9]+)/g)].map(m => m[1]))];
    const liCount = (result.body.match(/<li/g) || []).length;

    if (liCount === 0) break;   // 마지막 페이지 도달

    goodsNos.forEach(g => allGoodsNos.add(g));
    console.log(`  pageIdx=${pageIdx}: ${liCount}개 항목 (누적 ${allGoodsNos.size})`);
  }

  console.log(`  ✅ 오특 상품 총 ${allGoodsNos.size}개 수집 완료`);
  return allGoodsNos;
}

// 페이지에서 상품 목록 추출
async function extractProducts(page) {
  return page.evaluate(() => {
    const items = document.querySelectorAll('.cate_prd_list li');
    return Array.from(items).map(item => {
      const brandEl     = item.querySelector('.tx_brand');
      const nameEl      = item.querySelector('.tx_name');
      const salePriceEl = item.querySelector('.tx_cur .tx_num');
      const listPriceEl = item.querySelector('.tx_org .tx_num');
      const linkEl      = item.querySelector('a.goods_btn_link') || item.querySelector('a');
      const badgeEls    = item.querySelectorAll('.icon_flag');
      const soldOutEl   = item.querySelector('.soldout') || item.querySelector('[class*="sold"]');
      // 오특 전용 배지 (.newOyflag) 도 확인
      const otukEl      = item.querySelector('.newOyflag');

      const badgeTexts = Array.from(badgeEls).map(b => b.textContent.trim()).filter(Boolean);
      if (otukEl && !badgeTexts.includes('오특')) {
        const otukText = otukEl.textContent.trim();
        if (otukText.includes('오특')) badgeTexts.unshift('오특');
      }

      return {
        brand_name_raw:   brandEl?.textContent?.trim() || '',
        product_name_raw: nameEl?.textContent?.trim() || '',
        sale_price_raw:   salePriceEl?.textContent?.trim() || '',
        list_price_raw:   listPriceEl?.textContent?.trim() || '',
        product_url:      linkEl?.href || '',
        badges:           badgeTexts.join(','),
        is_sold_out:      !!soldOutEl,
        has_newOyflag:    !!item.querySelector('.newOyflag'),
      };
    });
  });
}

// 단일 카테고리 수집
// otukGoodsNos: 오늘의 오특 상품 goodsNo Set (null이면 폴백 로직만 사용)
async function scrapeCategory(page, category, runId, snapshotDate, collectedAt, otukGoodsNos = null) {
  const { name, label, singlePage, baseUrl, params } = category;
  console.log(`\n[${label}] 수집 시작...`);

  const allRaw = [];

  if (singlePage) {
    // 한 페이지에 전부 있는 경우 (바디케어 등)
    const url = `${baseUrl}?${params}`;
    console.log(`  페이지 1/1 수집 중...`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const items = await extractProducts(page);
    allRaw.push(...items);
  } else {
    // 여러 페이지를 순회하는 경우 (스킨케어 등)
    const totalPages = Math.ceil(TARGET_COUNT / 24);
    for (let pageIdx = 1; pageIdx <= totalPages; pageIdx++) {
      const url = `${baseUrl}?${params}&pageIdx=${pageIdx}`;
      console.log(`  페이지 ${pageIdx}/${totalPages} 수집 중...`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
      const items = await extractProducts(page);
      if (items.length === 0) break;
      allRaw.push(...items);
      if (allRaw.length >= TARGET_COUNT) break;
    }
  }

  // 순위 부여 + 데이터 가공
  const products = allRaw
    .filter(p => p.product_name_raw)
    .slice(0, TARGET_COUNT)
    .map((p, index) => {
      const listPrice   = parsePrice(p.list_price_raw);
      const salePrice   = parsePrice(p.sale_price_raw);
      const discountAmt = (listPrice && salePrice) ? listPrice - salePrice : null;
      const discountRate = (listPrice && salePrice && listPrice > 0)
        ? Math.round((discountAmt / listPrice) * 1000) / 1000 : null;

      // 오특 판정: hotdeal 페이지의 goodsNo 매칭이 1순위 (정확함)
      // 폴백으로 기존 로직 (badges/상품명/.newOyflag) 유지 — 올리브영이 동적 부착을 다시 켜는 경우 대비
      const goodsNo  = extractGoodsNo(p.product_url);
      const otukByHotdeal = goodsNo && otukGoodsNos ? otukGoodsNos.has(goodsNo) : false;
      const otukByBadge   = p.badges.includes('오특') || p.product_name_raw.includes('오특') || p.has_newOyflag;
      const hasOtuk  = otukByHotdeal || otukByBadge;

      // 오특 상품인데 badges에 '오특'이 없으면 추가 — 대시보드 badge UI 호환
      let badges = p.badges;
      if (hasOtuk && !badges.split(',').includes('오특')) {
        badges = badges ? `오특,${badges}` : '오특';
      }

      return {
        snapshot_date:         snapshotDate,
        collected_at:          collectedAt,
        run_id:                runId,
        category:              name,
        rank:                  index + 1,
        product_name_raw:      p.product_name_raw,
        brand_name_raw:        p.brand_name_raw,
        list_price:            listPrice,
        sale_price:            salePrice,
        price_discount_amount: discountAmt,
        price_discount_rate:   discountRate,
        product_url:           p.product_url,
        badges:                badges,
        is_sold_out:           p.is_sold_out,
        has_otuk:              hasOtuk,
        source_url:            `${baseUrl}?${params}`,
      };
    });

  // 오특 감지 출력
  const otukList = products.filter(p => p.has_otuk);
  if (otukList.length > 0) {
    console.log(`  🔥 오특 상품 ${otukList.length}개 감지!`);
    otukList.forEach(p => console.log(`     [${p.rank}위] ${p.brand_name_raw} - ${p.product_name_raw.slice(0, 28)}`));
  }

  console.log(`  ✅ ${products.length}개 수집 완료`);
  products.slice(0, 3).forEach(p => {
    const disc = p.price_discount_rate ? ` (${Math.round(p.price_discount_rate*100)}% 할인)` : '';
    console.log(`  [${p.rank}위] ${p.brand_name_raw} | ${p.product_name_raw.slice(0, 28)} | ${p.sale_price?.toLocaleString()}원${disc}`);
  });

  return products;
}

// 전체 수집 (모든 카테고리)
async function scrapeAll(categories) {
  const runId        = makeRunId();
  const snapshotDate = today();
  const collectedAt  = new Date().toISOString();

  console.log(`\n[${runId}] 전체 수집 시작`);
  console.log(`날짜: ${snapshotDate} | 카테고리: ${categories.map(c=>c.label).join(', ')}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // 카테고리 수집 전, 오늘의 오특 상품 goodsNo Set을 미리 수집
    // 실패해도 폴백 로직이 있으니 전체 파이프라인은 계속 진행
    let otukGoodsNos = new Set();
    try {
      otukGoodsNos = await fetchTodaysOtukGoodsNos(page);
    } catch (err) {
      console.warn(`⚠️  오특 목록 수집 실패 (폴백 로직만 사용): ${err.message}`);
    }

    const allProducts = [];
    for (const category of categories) {
      const products = await scrapeCategory(page, category, runId, snapshotDate, collectedAt, otukGoodsNos);
      allProducts.push(...products);
    }

    console.log(`\n✅ 전체 수집 완료: ${allProducts.length}개 (${categories.length}개 카테고리)`);
    return allProducts;

  } catch (err) {
    console.error('❌ 수집 실패:', err.message);
    if (browser) {
      const pages = browser.contexts()[0]?.pages();
      if (pages?.length > 0) {
        await pages[0].screenshot({ path: `debug/error-${makeRunId()}.png` });
      }
    }
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrapeAll };

if (require.main === module) {
  const { CATEGORIES } = require('./categories');
  scrapeAll(CATEGORIES).catch(() => process.exit(1));
}
