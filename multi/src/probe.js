// 임시 조사용: 페이지가 보내는 XHR/fetch 요청과 응답 앞부분을 로그로 남긴다. DB 저장 없음.
const { withPage } = require('./lib/browser');

async function main() {
  const which = process.argv[2];
  await withPage(async page => {
    const log = [];
    page.on('response', async res => {
      const t = res.request().resourceType();
      if (!['xhr', 'fetch', 'document'].includes(t)) return;
      let body = '';
      try { body = (await res.text()).replace(/\s+/g, ' ').slice(0, 400); } catch {}
      log.push(`${t} ${res.status()} ${res.headers()['content-type'] || ''} ${res.url().slice(0, 300)}\n    ${body}`);
    });

    if (which === 'oy_global') {
      await page.goto('https://global.oliveyoung.com/display/page/best-seller?target=pillsTab1Nav1', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(6000);
      console.log('--- 초기 로드');
      log.splice(0).forEach(l => console.log(l));
      const panel = await page.$('#pillsTab1Cont1');
      console.log('panel exists', !!panel);
      const btns = await page.$$eval('#pillsTab1Cont1 button, #pillsTab1Cont1 a, #pillsTab1Cont1 li, #pillsTab1Cont1 [data-ctgr-no], [onclick*="ctgr"], [data-ctgrno]', els =>
        els.slice(0, 60).map(e => `${e.tagName}#${e.id}.${e.className} vis=${!!e.offsetParent} attrs=${[...e.attributes].map(a => a.name + '=' + a.value).join(' ').slice(0, 200)} text=${e.textContent.trim().slice(0, 40)}`));
      console.log('--- 패널 안 클릭 후보\n' + btns.join('\n'));
      const html = await page.$eval('#pillsTab1Cont1', e => e.outerHTML.replace(/\s+/g, ' ').slice(0, 4000)).catch(e => 'ERR ' + e.message);
      console.log('--- 패널 HTML\n' + html);
      // 보이는 'Skincare' 요소 클릭 시도
      const cands = page.locator('#pillsTab1Cont1').getByText(/skin\s*care/i);
      console.log('skincare in panel count', await cands.count());
      try { await cands.first().click({ timeout: 5000 }); } catch (e) { console.log('click err', e.message.split('\n')[0]); }
      await page.waitForTimeout(5000);
      console.log('--- 클릭 후');
      log.splice(0).forEach(l => console.log(l));
    }

    if (which === 'musinsa') {
      await page.goto('https://www.musinsa.com/main/beauty/ranking', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(4000);
      for (const period of ['REALTIME', 'DAILY', 'WEEKLY', 'MONTHLY']) {
        const r = await page.evaluate(async p => {
          const u = `https://client.musinsa.com/api/home/web/v5/pans/ranking/sections/231?storeCode=beauty&gf=A&ageBand=AGE_BAND_ALL&period=${p}&categoryCode=104001&contentsId=&subPan=product&page=1`;
          const res = await fetch(u, { credentials: 'include' });
          const j = await res.json().catch(() => null);
          const items = [];
          (j?.data?.modules || []).forEach(m => (m.items || []).forEach(i => i.type === 'PRODUCT_COLUMN' && items.push(i)));
          return { status: res.status, n: items.length, ranks: items.map(i => i.image?.rank).slice(0, 5).concat(items.map(i => i.image?.rank).slice(-3)),
            first: items[0]?.info?.productName, modules: (j?.data?.modules || []).map(m => m.type).slice(0, 40) };
        }, period);
        console.log(period, JSON.stringify(r));
      }
    }
  }, { locale: which === 'oy_global' ? 'en-US' : 'ko-KR' });
}
main().catch(e => { console.error(e); process.exit(1); });
