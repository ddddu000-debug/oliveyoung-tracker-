const { chromium } = require('playwright');
require('dotenv').config();

const TARGET_COUNT = 100;

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
      };
    });
  });
}

// 단일 카테고리 수집
async function scrapeCategory(page, category, runId, snapshotDate, collectedAt) {
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

      const hasOtuk = p.badges.includes('오특') || p.product_name_raw.includes('오특');

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
        badges:                p.badges,
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

    const allProducts = [];
    for (const category of categories) {
      const products = await scrapeCategory(page, category, runId, snapshotDate, collectedAt);
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
