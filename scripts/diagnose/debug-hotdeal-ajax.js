// hotdeal ajax 응답 구조 분석
// pageIdx별로 응답을 받아 goodsNo 추출, 끝 조건 확인

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const today = (() => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
})();

async function diagnose() {
  const debugDir = path.join(__dirname, '..', 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // 먼저 hotdeal 페이지를 한 번 띄워서 세션 쿠키 / Referer 환경 만들기
  console.log('hotdeal 페이지 방문 (세션 준비)...');
  await page.goto('https://www.oliveyoung.co.kr/store/main/getHotdealList.do', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  // pageIdx 1~10 까지 직접 ajax 호출
  for (let pageIdx = 1; pageIdx <= 10; pageIdx++) {
    const url = `https://www.oliveyoung.co.kr/store/main/getHotdealPagingListAjax.do?date=${today}&pageIdx=${pageIdx}&fltCondition=02&fltDispCatNo=&prdSort=rank`;
    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'include' });
        const text = await res.text();
        return { status: res.status, length: text.length, body: text };
      } catch (e) {
        return { error: e.message };
      }
    }, url);

    if (result.error) {
      console.log(`[pageIdx=${pageIdx}] 실패: ${result.error}`);
      continue;
    }

    // goodsNo 추출
    const goodsNos = [...new Set([...result.body.matchAll(/goodsNo=([A-Z0-9]+)/g)].map(m => m[1]))];
    const liCount = (result.body.match(/<li/g) || []).length;
    const brandNames = [...result.body.matchAll(/<span class="tx_brand">([^<]+)<\/span>/g)].map(m => m[1].trim()).slice(0, 3);
    const productNames = [...result.body.matchAll(/<p class="tx_name">([^<]+)<\/p>/g)].map(m => m[1].trim()).slice(0, 3);

    console.log(`\n[pageIdx=${pageIdx}] HTTP ${result.status}, ${result.length} bytes`);
    console.log(`  <li> 개수: ${liCount}`);
    console.log(`  goodsNo 개수: ${goodsNos.length} → ${goodsNos.slice(0, 8).join(', ')}${goodsNos.length>8?'...':''}`);
    console.log(`  브랜드 샘플: ${JSON.stringify(brandNames)}`);
    console.log(`  상품 샘플: ${JSON.stringify(productNames)}`);

    // 응답 저장 (디버그용)
    fs.writeFileSync(path.join(debugDir, `hotdeal-ajax-p${pageIdx}.html`), result.body, 'utf8');

    // 끝 조건: <li>가 0개거나 빈 응답
    if (liCount === 0) {
      console.log(`  → 끝!`);
      break;
    }
  }

  await browser.close();
}

diagnose().catch(err => {
  console.error('실패:', err);
  process.exit(1);
});
