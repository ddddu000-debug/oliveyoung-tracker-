// 사이트 구조 확인용: 랭킹 페이지를 열어 오가는 JSON 응답과 카테고리 탭 후보를 저장한다.
// 사용법: node src/discover.js musinsa   → discover-out/musinsa.json, musinsa.png
const fs = require('fs');
const SOURCES = require('./sources');
const { withPage, captureJson, findProductArrays } = require('./lib/browser');

async function main() {
  const platform = process.argv[2];
  const src = SOURCES[platform];
  if (!src || !src.PAGE_URL) throw new Error(`discover 대상: ${Object.keys(SOURCES).filter(k => SOURCES[k].PAGE_URL).join(', ')}`);
  fs.mkdirSync('discover-out', { recursive: true });

  await withPage(async page => {
    const captured = captureJson(page);
    await page.goto(src.PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(800); }

    // 탭/버튼처럼 보이는 짧은 텍스트 후보
    const tabs = await page.$$eval('button, a, li, [role=tab]', els =>
      [...new Set(els.map(e => e.textContent.trim()).filter(t => t && t.length <= 20))].slice(0, 300));

    // 카테고리 하나를 실제로 눌러 보고 그 뒤 응답도 기록
    const clickLog = [];
    for (const cat of src.categories) {
      const before = captured.length;
      try {
        await page.getByText(cat.labelRe).first().click({ timeout: 8000 });
        await page.waitForTimeout(4000);
        clickLog.push({ category: cat.category, ok: true, newResponses: captured.slice(before).map(r => r.url) });
      } catch (e) {
        clickLog.push({ category: cat.category, ok: false, error: e.message.split('\n')[0] });
      }
    }

    const responses = captured.map(r => ({
      url: r.url,
      status: r.status,
      productArrays: findProductArrays(r.body).map(a => ({ path: a.path, length: a.items.length, sample: a.items.slice(0, 2) })),
    }));

    fs.writeFileSync(`discover-out/${platform}.json`, JSON.stringify({ page: src.PAGE_URL, tabs, clickLog, responses }, null, 2));
    await page.screenshot({ path: `discover-out/${platform}.png`, fullPage: true });

    console.log(`JSON 응답 ${responses.length}개, 상품 배열 포함 ${responses.filter(r => r.productArrays.length).length}개`);
    responses.filter(r => r.productArrays.length).forEach(r =>
      console.log(` - ${r.url}\n   ${r.productArrays.map(a => `${a.path} (${a.length}개)`).join(', ')}`));
    clickLog.forEach(c => console.log(` 클릭 ${c.category}: ${c.ok ? `OK, 새 응답 ${c.newResponses.length}개` : c.error}`));
  }, { locale: platform === 'oy_global' ? 'en-US' : 'ko-KR' });
}

main().catch(err => { console.error(err); process.exit(1); });
