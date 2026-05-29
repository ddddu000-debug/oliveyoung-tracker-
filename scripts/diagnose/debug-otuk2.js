// 오특 진단 2단계
// 1) hotdeal 페이지 자체를 직접 긁기
// 2) 베스트 랭킹 페이지에서 더 길게 대기 → .newOyflag이 비동기로 부착되는지 확인

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOTDEAL_URL = 'https://www.oliveyoung.co.kr/store/main/getHotdealList.do';
const BODYCARE_URL = 'https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=10000010003&pageIdx=1&rowsPerPage=8';

async function diagnose() {
  const debugDir = path.join(__dirname, '..', 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // 모든 네트워크 요청 로깅
  const apiCalls = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('todaySpecial') || url.includes('todayspecial') || url.includes('hotdeal') || url.includes('Hotdeal') || url.includes('oyFlag') || url.includes('OyFlag')) {
      let body = '';
      try { body = (await res.text()).slice(0, 500); } catch (e) {}
      apiCalls.push({ url, status: res.status(), body });
    }
  });

  // ── A) hotdeal 페이지 직접 ─────────────────────────────────────────
  console.log(`\n========================================`);
  console.log(` [A] HOTDEAL 페이지 직접 진단`);
  console.log(`========================================`);
  console.log(` URL: ${HOTDEAL_URL}`);

  try {
    await page.goto(HOTDEAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);

    const struct = await page.evaluate(() => {
      // 후보 셀렉터로 상품 리스트 위치를 찾는다
      const tries = [
        '.cate_prd_list li',
        '.prd_list li',
        '.list_prd li',
        '.list_box li',
        '#hotdeal_list li',
        '[class*="prd_list"] li',
        '[class*="goods"] li',
      ];
      const result = {};
      tries.forEach(sel => {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) {
          result[sel] = {
            count: items.length,
            firstHTML: items[0].outerHTML.slice(0, 400).replace(/\s+/g, ' '),
          };
        }
      });
      // 페이지 title / h1 / h2 정보
      const title = document.title;
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      const h2 = [...document.querySelectorAll('h2')].slice(0, 3).map(h => h.textContent.trim());

      return { title, h1, h2, sels: result };
    });

    console.log(`\n페이지 정보:`);
    console.log(`  title: ${struct.title}`);
    console.log(`  h1: ${struct.h1}`);
    console.log(`  h2: ${JSON.stringify(struct.h2)}`);
    console.log(`\n상품 리스트 후보 셀렉터:`);
    if (Object.keys(struct.sels).length === 0) {
      console.log(`  ❌ 알려진 셀렉터에 적중 없음`);
    } else {
      Object.entries(struct.sels).forEach(([sel, info]) => {
        console.log(`  ${sel} → ${info.count}개`);
        console.log(`    첫 항목: ${info.firstHTML}`);
      });
    }

    const html = await page.content();
    const htmlPath = path.join(debugDir, `oy-hotdeal-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log(`\nHTML 저장: ${htmlPath}`);

    const shotPath = path.join(debugDir, `oy-hotdeal-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`스크린샷: ${shotPath}`);

  } catch (err) {
    console.error(`❌ hotdeal 페이지 실패: ${err.message}`);
  }

  // ── B) 베스트 랭킹 페이지 + 긴 대기 → .newOyflag 부착 확인 ──────────
  console.log(`\n========================================`);
  console.log(` [B] BODYCARE 랭킹 페이지 - 긴 대기로 .newOyflag 부착 확인`);
  console.log(`========================================`);

  try {
    await page.goto(BODYCARE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // 1초마다 .newOyflag 개수 확인 (총 10초)
    for (let i = 1; i <= 10; i++) {
      await page.waitForTimeout(1000);
      const count = await page.evaluate(() => document.querySelectorAll('.newOyflag').length);
      console.log(`  ${i}초 후: .newOyflag = ${count}개`);
    }

    // 최종 상태에서 모든 정보 다시 수집
    const finalState = await page.evaluate(() => {
      const oys = document.querySelectorAll('.newOyflag');
      const samples = [];
      oys.forEach((el, idx) => {
        if (idx >= 5) return;
        samples.push({
          tag: el.tagName.toLowerCase(),
          className: el.className,
          text: el.textContent.trim().slice(0, 50),
          parentClass: el.parentElement?.className || '',
          outer: el.outerHTML.slice(0, 250).replace(/\s+/g, ' '),
        });
      });
      // .newOyflag 부착 위치 패턴 확인
      const inItems = document.querySelectorAll('.cate_prd_list li .newOyflag').length;
      return { total: oys.length, samples, inItems };
    });

    console.log(`\n최종 .newOyflag 상태:`);
    console.log(`  전체: ${finalState.total}개`);
    console.log(`  랭킹 상품 안에 있는 것: ${finalState.inItems}개`);
    if (finalState.samples.length > 0) {
      console.log(`  샘플:`);
      finalState.samples.forEach(s => {
        console.log(`    <${s.tag} class="${s.className}"> "${s.text}"`);
        console.log(`      parent.class="${s.parentClass}"`);
        console.log(`      outerHTML: ${s.outer}`);
      });
    }

  } catch (err) {
    console.error(`❌ 베스트 랭킹 실패: ${err.message}`);
  }

  // ── C) 캡처된 오특 관련 API 호출 ────────────────────────────────────
  console.log(`\n========================================`);
  console.log(` [C] 캡처된 오특/hotdeal 관련 네트워크 요청`);
  console.log(`========================================`);
  if (apiCalls.length === 0) {
    console.log(`  (없음)`);
  } else {
    apiCalls.forEach((call, i) => {
      console.log(`  [${i+1}] ${call.status} ${call.url}`);
      console.log(`       body: ${call.body.replace(/\s+/g, ' ').slice(0, 300)}`);
    });
  }

  await browser.close();
  console.log(`\n진단 완료`);
}

diagnose().catch(err => {
  console.error('진단 실패:', err);
  process.exit(1);
});
