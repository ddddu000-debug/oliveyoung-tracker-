const { chromium } = require('playwright');
require('dotenv').config();

const BASE_URL = 'https://www.oliveyoung.co.kr/store/display/getMCategoryList.do';
const PARAMS   = 'dispCatNo=100000100010013&fltDispCatNo=&prdSort=01&rowsPerPage=24&searchTypeSort=btn_thumb&plusButtonFlag=N&isLoginCnt=0&aShowCnt=0&bShowCnt=0&cShowCnt=0&trackingCd=Cat100000100010013_Ranking';
const TARGET_COUNT = 100; // 수집할 최대 순위

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

// 한 페이지에서 상품 목록 추출
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

      return {
        brand_name_raw:   brandEl?.textContent?.trim() || '',
        product_name_raw: nameEl?.textContent?.trim() || '',
        sale_price_raw:   salePriceEl?.textContent?.trim() || '',
        list_price_raw:   listPriceEl?.textContent?.trim() || '',
        product_url:      linkEl?.href || '',
        badges:           Array.from(badgeEls).map(b => b.textContent.trim()).join(','),
        is_sold_out:      !!soldOutEl,
      };
    });
  });
}

async function scrape() {
  const runId        = makeRunId();
  const snapshotDate = today();
  const collectedAt  = new Date().toISOString();

  console.log(`\n[${runId}] 수집 시작`);
  console.log(`날짜: ${snapshotDate} | 목표: ${TARGET_COUNT}위`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    const allRaw = [];
    const totalPages = Math.ceil(TARGET_COUNT / 24); // 24개씩 → 5페이지

    for (let pageIdx = 1; pageIdx <= totalPages; pageIdx++) {
      const url = `${BASE_URL}?${PARAMS}&pageIdx=${pageIdx}`;
      console.log(`  페이지 ${pageIdx}/${totalPages} 수집 중...`);

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);

      const items = await extractProducts(page);
      if (items.length === 0) {
        console.log(`  페이지 ${pageIdx}: 상품 없음 — 중단`);
        break;
      }

      allRaw.push(...items);
      if (allRaw.length >= TARGET_COUNT) break;
    }

    // 순위 번호 부여 + 데이터 가공
    const products = allRaw
      .filter(p => p.product_name_raw)
      .slice(0, TARGET_COUNT)
      .map((p, index) => {
        const listPrice    = parsePrice(p.list_price_raw);
        const salePrice    = parsePrice(p.sale_price_raw);
        const discountAmt  = (listPrice && salePrice) ? listPrice - salePrice : null;
        const discountRate = (listPrice && salePrice && listPrice > 0)
          ? Math.round((discountAmt / listPrice) * 1000) / 1000 : null;

        // 오특 감지: 배지 또는 상품명에 "오특" 포함 여부
        const badgesText = p.badges || '';
        const nameText   = p.product_name_raw || '';
        const hasOtuk    = badgesText.includes('오특') || nameText.includes('오특');

        return {
          snapshot_date:         snapshotDate,
          collected_at:          collectedAt,
          run_id:                runId,
          category:              process.env.CATEGORY || 'skincare',
          rank:                  index + 1,
          product_name_raw:      p.product_name_raw,
          brand_name_raw:        p.brand_name_raw,
          list_price:            listPrice,
          sale_price:            salePrice,
          price_discount_amount: discountAmt,
          price_discount_rate:   discountRate,
          product_url:           p.product_url,
          badges:                badgesText,
          is_sold_out:           p.is_sold_out,
          has_otuk:              hasOtuk,   // ← 오특 여부
          source_url:            `${BASE_URL}?${PARAMS}&pageIdx=1`,
        };
      });

    // 오특 탐지 결과
    const otukProducts = products.filter(p => p.has_otuk);
    if (otukProducts.length > 0) {
      console.log(`\n🔥 오특 상품 감지! (${otukProducts.length}개)`);
      otukProducts.forEach(p => console.log(`   [${p.rank}위] ${p.brand_name_raw} - ${p.product_name_raw.slice(0, 30)}`));
    }

    console.log(`\n✅ 수집 완료: ${products.length}개 상품`);
    console.log('--- 상위 5개 ---');
    products.slice(0, 5).forEach(p => {
      const disc = p.price_discount_rate ? ` (${Math.round(p.price_discount_rate*100)}% 할인)` : '';
      console.log(`[${p.rank}위] ${p.brand_name_raw} | ${p.product_name_raw.slice(0, 28)}`);
      console.log(`      ${p.sale_price?.toLocaleString()}원${disc}`);
    });

    return products;

  } catch (err) {
    console.error('❌ 수집 실패:', err.message);
    if (browser) {
      const pages = browser.contexts()[0]?.pages();
      if (pages?.length > 0) {
        await pages[0].screenshot({ path: `debug/error-${runId}.png` });
        console.log(`스크린샷 저장: debug/error-${runId}.png`);
      }
    }
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { scrape };

if (require.main === module) {
  scrape().catch(() => process.exit(1));
}
