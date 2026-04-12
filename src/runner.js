const { scrapeAll }                              = require('./scraper');
const { CATEGORIES }                             = require('./categories');
const { saveRawSnapshots, saveDailyChanges,
        saveBrandEntries, readSheet, getSheets }  = require('./sheets');
const { analyze }                                = require('./analyzer');
const { updateDashboard }                        = require('./dashboard');
const { generateReport }                         = require('./report');
const { makeProductKey }                         = require('./normalizer');
const log                                        = require('./logger');
require('dotenv').config();

// 실패 시 최대 3번 재시도 (1초 → 3초 → 9초 간격)
async function withRetry(fn, name, maxTries = 3) {
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      log.warn(`${name} 실패 (${attempt}/${maxTries}): ${err.message}`);
      if (attempt === maxTries) throw err;
      const wait = Math.pow(3, attempt - 1) * 1000;
      log.info(`${wait / 1000}초 후 재시도...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function run() {
  const startTime = Date.now();
  log.info('============================');
  log.info(' 올리브영 랭킹 수집 시작');
  log.info('============================');

  try {
    // 1. 수집 (실패 시 3회 재시도)
    const products = await withRetry(() => scrapeAll(CATEGORIES), '수집');

    // 2. product_key 붙이기
    products.forEach(p => {
      p.product_key = makeProductKey(p.brand_name_raw, p.product_name_raw);
    });

    // 3. 카테고리별로 저장 + 분석
    const sheets  = await getSheets();
    const allDailyChanges = [];
    const allBrandEntries = [];

    for (const category of CATEGORIES) {
      const catProducts = products.filter(p => p.category === category.name);
      if (catProducts.length === 0) continue;

      log.info(`\n[${category.label}] 처리 중...`);

      // raw_snapshots 저장
      await withRetry(() => saveRawSnapshots(catProducts), `${category.label} raw_snapshots 저장`);

      // 전체 데이터 읽기 (카테고리 필터링)
      const allRows   = await readSheet(sheets, 'raw_snapshots');
      const catRows   = [allRows[0], ...allRows.slice(1).filter(r => r[3] === category.name)];

      // 변동 분석
      const { dailyChanges, brandEntries } = analyze(catRows, catProducts);
      allDailyChanges.push(...dailyChanges);
      allBrandEntries.push(...brandEntries);

      const risers = dailyChanges.filter(c => c.rank_change > 0).length;
      const fallers = dailyChanges.filter(c => c.rank_change < 0).length;
      const newOnes = dailyChanges.filter(c => c.is_new_entry).length;
      log.info(`  순위 상승: ${risers}개 | 하락: ${fallers}개 | 신규: ${newOnes}개`);
    }

    // 6. daily_changes 저장
    await withRetry(() => saveDailyChanges(allDailyChanges), 'daily_changes 저장');

    // 7. brand_entries 저장
    await withRetry(() => saveBrandEntries(allBrandEntries), 'brand_entries 저장');

    // 8. dashboard 갱신
    await withRetry(() => updateDashboard(products, allDailyChanges), 'dashboard 갱신');

    // 9. HTML 대시보드 생성
    await withRetry(() => generateReport(), 'HTML 대시보드 생성');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info(`============================`);
    log.info(` ✅ 완료! (${elapsed}초 소요)`);
    log.info(`============================`);

  } catch (err) {
    log.error(`============================`);
    log.error(` ❌ 최종 실패: ${err.message}`);
    log.error(`============================`);
    process.exit(1);
  }
}

run();
