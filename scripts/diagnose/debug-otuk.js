// 오특 배지 셀렉터 진단 스크립트
// 사용: node src/debug-otuk.js
// 올리브영 실제 페이지를 띄워 오특 관련 HTML이 어떻게 표시되는지 확인

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGETS = [
  {
    name: 'bodycare',
    url:  'https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=10000010003&pageIdx=1&rowsPerPage=8',
  },
  {
    name: 'skincare',
    url:  'https://www.oliveyoung.co.kr/store/display/getMCategoryList.do?dispCatNo=100000100010013&fltDispCatNo=&prdSort=01&rowsPerPage=24&searchTypeSort=btn_thumb&plusButtonFlag=N&isLoginCnt=0&aShowCnt=0&bShowCnt=0&cShowCnt=0&trackingCd=Cat100000100010013_Ranking&pageIdx=1',
  },
];

async function diagnose() {
  const debugDir = path.join(__dirname, '..', 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  for (const target of TARGETS) {
    console.log(`\n========================================`);
    console.log(` [${target.name}] 진단 시작`);
    console.log(`========================================`);
    console.log(` URL: ${target.url}`);

    try {
      await page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // 1) 현재 코드가 쓰는 셀렉터 매칭 결과
      const current = await page.evaluate(() => {
        const items = document.querySelectorAll('.cate_prd_list li');
        const result = {
          total_items: items.length,
          icon_flag_count: 0,
          icon_flag_texts: new Set(),
          newOyflag_count: 0,
          newOyflag_texts: new Set(),
          otuk_in_icon_flag: 0,
          otuk_in_name: 0,
        };
        items.forEach(item => {
          const flags = item.querySelectorAll('.icon_flag');
          flags.forEach(f => {
            result.icon_flag_count++;
            const t = f.textContent.trim();
            if (t) result.icon_flag_texts.add(t);
            if (t.includes('오특')) result.otuk_in_icon_flag++;
          });
          const oy = item.querySelectorAll('.newOyflag');
          oy.forEach(f => {
            result.newOyflag_count++;
            const t = f.textContent.trim();
            if (t) result.newOyflag_texts.add(t);
          });
          const nameEl = item.querySelector('.tx_name');
          if (nameEl && nameEl.textContent.includes('오특')) result.otuk_in_name++;
        });
        result.icon_flag_texts = [...result.icon_flag_texts];
        result.newOyflag_texts = [...result.newOyflag_texts];
        return result;
      });

      console.log(`\n[1] 현재 셀렉터 적중 여부:`);
      console.log(`    .cate_prd_list li             : ${current.total_items}개`);
      console.log(`    .icon_flag (총)               : ${current.icon_flag_count}개`);
      console.log(`    .icon_flag 텍스트 종류        : ${JSON.stringify(current.icon_flag_texts)}`);
      console.log(`    .icon_flag에 "오특" 포함      : ${current.otuk_in_icon_flag}개`);
      console.log(`    .newOyflag (총)               : ${current.newOyflag_count}개`);
      console.log(`    .newOyflag 텍스트 종류        : ${JSON.stringify(current.newOyflag_texts)}`);
      console.log(`    상품명에 "오특" 포함          : ${current.otuk_in_name}개`);

      // 2) "오특" 텍스트가 들어있는 요소의 클래스/태그/속성 전수조사
      const otukCandidates = await page.evaluate(() => {
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        const seen = new Set();
        let node;
        while ((node = walker.nextNode())) {
          const txt = node.nodeValue;
          if (txt && (txt.includes('오특') || txt.includes('오늘의 특가') || txt.includes('오늘의특가'))) {
            const parent = node.parentElement;
            if (!parent) continue;
            const key = parent.outerHTML.slice(0, 200);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
              text: txt.trim().slice(0, 60),
              tag: parent.tagName.toLowerCase(),
              className: parent.className || '',
              id: parent.id || '',
              parentClass: parent.parentElement?.className || '',
              outer: parent.outerHTML.slice(0, 250),
            });
          }
          if (out.length >= 30) break;
        }
        return out;
      });

      console.log(`\n[2] "오특"/"오늘의 특가" 텍스트가 포함된 요소 (최대 30개):`);
      if (otukCandidates.length === 0) {
        console.log(`    ❌ 페이지 어디에도 "오특" 관련 텍스트가 발견되지 않음`);
      } else {
        otukCandidates.forEach((c, i) => {
          console.log(`    [${i+1}] <${c.tag} class="${c.className}"> "${c.text}"`);
          console.log(`         parent.class="${c.parentClass}"`);
          console.log(`         outerHTML: ${c.outer.replace(/\s+/g, ' ')}`);
        });
      }

      // 3) 가능한 신규 배지 클래스들 후보 검사
      const candidates = await page.evaluate(() => {
        const selectors = [
          '.flag', '.flag_box', '.flag_wrap',
          '.tag', '.tag_flag', '.tag_box',
          '.badge', '.tx_flag',
          '[class*="otuk"]', '[class*="oyflag"]', '[class*="oy_flag"]',
          '[class*="todayspec"]', '[class*="today_sale"]', '[class*="todaysale"]',
          '[class*="ohto"]', '[class*="otd"]',
          'img[alt*="오특"]', 'img[alt*="오늘의 특가"]',
        ];
        const out = {};
        selectors.forEach(sel => {
          try {
            const matches = document.querySelectorAll(sel);
            if (matches.length === 0) return;
            const samples = [];
            const texts = new Set();
            matches.forEach((m, idx) => {
              const t = (m.textContent || m.alt || '').trim();
              if (t) texts.add(t.slice(0, 30));
              if (idx < 3) {
                samples.push(m.outerHTML.slice(0, 180).replace(/\s+/g, ' '));
              }
            });
            out[sel] = {
              count: matches.length,
              texts: [...texts].slice(0, 6),
              samples,
            };
          } catch (e) { /* invalid selector — skip */ }
        });
        return out;
      });

      console.log(`\n[3] 신규 배지 후보 셀렉터 (적중한 것만):`);
      if (Object.keys(candidates).length === 0) {
        console.log(`    (적중 없음)`);
      } else {
        Object.entries(candidates).forEach(([sel, info]) => {
          console.log(`    ${sel}  →  ${info.count}개, 텍스트=${JSON.stringify(info.texts)}`);
          info.samples.forEach(s => console.log(`        ${s}`));
        });
      }

      // 4) HTML 통째로 저장
      const html = await page.content();
      const htmlPath = path.join(debugDir, `oy-${target.name}-${Date.now()}.html`);
      fs.writeFileSync(htmlPath, html, 'utf8');
      console.log(`\n[4] 페이지 HTML 저장: ${htmlPath}`);

      // 5) 스크린샷 (top of page only)
      const shotPath = path.join(debugDir, `oy-${target.name}-${Date.now()}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      console.log(`    스크린샷 저장: ${shotPath}`);

    } catch (err) {
      console.error(`❌ [${target.name}] 실패: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\n========================================`);
  console.log(` 진단 완료`);
  console.log(`========================================\n`);
}

diagnose().catch(err => {
  console.error('진단 스크립트 실패:', err);
  process.exit(1);
});
