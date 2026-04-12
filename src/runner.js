const { scrapeAll }             = require('./scraper');
const { CATEGORIES }            = require('./categories');
const { saveRawSnapshots,
        saveDailyChanges,
        saveBrandEntries,
        fetchYesterdaySnapshots } = require('./database');
const { analyze }               = require('./analyzer');
const { updateDashboard }       = require('./dashboard');
const { generateReport }        = require('./report');
const { makeProductKey,
        normalizeBrand }        = require('./normalizer');
const { createClient }          = require('@supabase/supabase-js');
const log                       = require('./logger');
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

// 과거에 등장한 브랜드 key 목록 조회
async function fetchPastBrandKeys(category, today) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const { data } = await supabase
    .from('raw_snapshots')
    .select('brand_name_raw')
    .eq('category', category)
    .lt('snapshot_date', today);
  const keys = new Set((data || []).map(r => normalizeBrand(r.brand_name_raw)));
  return keys;
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
    const allDailyChanges = [];
    const allBrandEntries = [];

    for (const category of CATEGORIES) {
      const catProducts = products.filter(p => p.category === category.name);
      if (catProducts.length === 0) continue;

      log.info(`\n[${category.label}] 처리 중...`);

      // raw_snapshots 저장
      await withRetry(() => saveRawSnapshots(catProducts), `${category.label} raw_snapshots 저장`);

      // 어제 데이터 + 과거 브랜드 목록 조회
      const today           = catProducts[0].snapshot_date;
      const yesterdayData   = await withRetry(() => fetchYesterdaySnapshots(category.name), `${category.label} 어제 데이터 조회`);
      const pastBrandKeys   = await withRetry(() => fetchPastBrandKeys(category.name, today), `${category.label} 과거 브랜드 조회`);

      // 변동 분석
      const { dailyChanges, brandEntries } = analyze(yesterdayData, catProducts, pastBrandKeys);
      allDailyChanges.push(...dailyChanges);
      allBrandEntries.push(...brandEntries);

      const risers  = dailyChanges.filter(c => c.rank_change > 0).length;
      const fallers = dailyChanges.filter(c => c.rank_change < 0).length;
      const newOnes = dailyChanges.filter(c => c.is_new_entry).length;
      log.info(`  순위 상승: ${risers}개 | 하락: ${fallers}개 | 신규: ${newOnes}개`);
    }

    // 4. daily_changes 저장
    await withRetry(() => saveDailyChanges(allDailyChanges), 'daily_changes 저장');

    // 5. brand_entries 저장
    await withRetry(() => saveBrandEntries(allBrandEntries), 'brand_entries 저장');

    // 6. dashboard 시트 갱신 (Google Sheets 대시보드 시트 - 선택적)
    // await withRetry(() => updateDashboard(products, allDailyChanges), 'dashboard 갱신');

    // 7. HTML 대시보드 생성
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
