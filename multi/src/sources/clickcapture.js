// JS 로 그려지는 랭킹 페이지 공통 수집:
// 페이지를 열고 카테고리 탭을 클릭한 뒤, 그 직후 도착한 JSON 응답에서 상품 배열을 꺼낸다.
const { findProductArrays } = require('../lib/browser');
const { sleep } = require('../lib/util');

async function clickCategory(page, scope, labelRe) {
  const root = scope ? page.locator(scope) : page;
  const target = root.getByText(labelRe).first();
  await target.scrollIntoViewIfNeeded({ timeout: 10000 });
  await target.click({ timeout: 10000 });
}

// captured: captureJson 이 채우는 배열. 클릭 이후 새로 들어온 응답 중 가장 큰 상품 배열을 쓴다.
async function scrapeByClick(page, captured, { scope, labelRe, waitMs = 4000 }) {
  const before = captured.length;
  await clickCategory(page, scope, labelRe);
  await sleep(waitMs);
  // 무한 스크롤로 100위까지 불러오는 경우 대비
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 4000);
    await sleep(800);
  }

  const fresh = captured.slice(before);
  const arrays = fresh.flatMap(r => findProductArrays(r.body).map(a => ({ ...a, url: r.url })));
  if (arrays.length === 0) return { items: [], sources: fresh.map(r => r.url) };

  // 같은 엔드포인트에서 페이지가 나눠 온 경우 합친다
  arrays.sort((a, b) => b.items.length - a.items.length);
  const main = arrays[0];
  const sameEndpoint = arrays.filter(a => a.url.split('?')[0] === main.url.split('?')[0] && a.path === main.path);
  const items = sameEndpoint.length > 1 ? sameEndpoint.flatMap(a => a.items) : main.items;
  return { items, sources: [...new Set(sameEndpoint.map(a => a.url))] };
}

module.exports = { scrapeByClick };
