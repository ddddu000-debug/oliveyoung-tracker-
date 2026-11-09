// 임시 조사용: 올영 글로벌 order-best API 구조 확인. DB 저장 없음.
const { withPage } = require('./lib/browser');

async function main() {
  await withPage(async page => {
    await page.goto('https://global.oliveyoung.com/display/page/best-seller?target=pillsTab1Nav1', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);
    const out = await page.evaluate(async () => {
      const cats = (await (await fetch('/display/page/best-seller-data?acesCntryCode=&langCode=en')).json()).ctgrList.map(c => [c.ctgrNo, c.ctgrName]);
      const res = {};
      for (const [no, name] of cats) {
        const u = `/display/product/best-seller/order-best?ctgrNo=${no}&acesCntryCode=00&previewDate=&encKey=&encText=&accParam=&dispPageTypeCode=30&langCode=en&dispPageNo=&mrgnCntryCode=20&dlvCntryCode=20&isGlobal=false&showSoldoutProduct=true`;
        const j = await (await fetch(u)).json();
        res[`${no} ${name}`] = Array.isArray(j) ? j.length : typeof j;
        if (name === 'Skincare') res.sample = Object.fromEntries(Object.entries(j[0]).filter(([, v]) => v !== null && v !== '' ));
      }
      return res;
    });
    console.log(JSON.stringify(out, null, 1).slice(0, 8000));
  }, { locale: 'en-US' });
}
main().catch(e => { console.error(e); process.exit(1); });
