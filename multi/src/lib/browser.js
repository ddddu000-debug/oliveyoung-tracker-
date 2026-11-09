const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// 사이트를 한 번 연 뒤(쿠키·세션 확보) 그 페이지 안에서 사이트 자체 API 를 fetch 한다.
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

// 페이지 컨텍스트에서 JSON 을 가져온다. 실패 시 백오프 재시도.
async function fetchJson(page, url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = await page.evaluate(async u => {
      try {
        const res = await fetch(u, { credentials: 'include' });
        return { status: res.status, body: res.ok ? await res.json() : null };
      } catch (e) {
        return { status: 0, error: e.message };
      }
    }, url);
    if (r.body) return r.body;
    console.log(`  ⚠️  요청 실패 status=${r.status} ${r.error || ''} (${attempt}/${retries})`);
    if (attempt < retries) await page.waitForTimeout(attempt * (r.status === 429 ? 10000 : 4000));
  }
  throw new Error(`API 요청 실패: ${url}`);
}

module.exports = { withPage, fetchJson };
