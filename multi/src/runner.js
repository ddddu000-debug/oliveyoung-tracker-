// 사용법: node src/runner.js [--platform=musinsa,oy_global] [--category=skincare] [--dry-run]
//   --dry-run: DB 에 쓰지 않고 수집 결과만 출력
// 플랫폼·카테고리마다 독립 실행: 하나가 실패해도 나머지는 저장된다.
const SOURCES = require('./sources');
const { withPage } = require('./lib/browser');
const { saveSnapshots, upsertProducts, logRun } = require('./lib/db');
const { kstDate, makeRunId, brandKey } = require('./lib/util');

const MIN_ITEMS = 50;   // 이보다 적으면 partial 로 기록
const DRY_RUN = process.argv.includes('--dry-run');

function arg(name) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1].split(',').filter(Boolean) : null;
}

async function runPlatform(src, runId, snapshotDate, onlyCats) {
  const cats = src.categories.filter(c => !onlyCats || onlyCats.includes(c.category));
  const results = [];

  await withPage(async page => {
    try {
      await src.prepare(page);
    } catch (err) {
      console.error(`[${src.platform}] 페이지 준비 실패: ${err.message}`);
      for (const c of cats) {
        if (!DRY_RUN) await logRun({ run_id: runId, platform: src.platform, category: c.category, snapshot_date: snapshotDate,
          status: 'failed', item_count: 0, error: `prepare: ${err.message}`, started_at: new Date().toISOString() });
        results.push('failed');
      }
      return;
    }

    for (const cat of cats) {
      const startedAt = new Date().toISOString();
      console.log(`\n[${src.platform} / ${cat.label}] 수집 중...`);
      try {
        const raw = await src.scrape(page, cat);
        const seen = new Set();
        const items = raw
          .filter(i => i.product_name)
          .map(i => ({ ...i, product_id: i.product_id || `name:${brandKey(i.brand_name)}_${brandKey(i.product_name)}` }))
          .filter(i => !seen.has(i.product_id) && seen.add(i.product_id))
          .map((i, idx) => ({
            snapshot_date: snapshotDate,
            platform:      src.platform,
            category:      cat.category,
            rank:          idx + 1,
            product_id:    i.product_id,
            brand_name:    i.brand_name,
            product_name:  i.product_name,
            currency:      i.currency,
            list_price:    i.list_price,
            sale_price:    i.sale_price,
            discount_rate: i.discount_rate,
            rating:        i.review_count === 0 ? null : i.rating,   // 리뷰 0개면 평점 0 대신 비움
            review_count:  i.review_count,
            badges:        i.badges || [],
            raw:           i.raw,
            run_id:        runId,
            collected_at:  new Date().toISOString(),
            product_url:   i.product_url,
            image_url:     i.image_url,
          }));

        if (items.length === 0) throw new Error('상품 0개');

        const status = items.length >= MIN_ITEMS ? 'success' : 'partial';
        if (DRY_RUN) {
          console.log(`  (dry-run) ${items.length}개, 저장 생략`);
          items.slice(0, 10).forEach(i => console.log(`  [${i.rank}] ${i.product_id} | ${i.brand_name} | ${String(i.product_name).slice(0, 40)} | ${i.sale_price}/${i.list_price} ${i.currency} | -${Math.round((i.discount_rate || 0) * 100)}% | ★${i.rating} (${i.review_count}) | ${i.badges.join(',')}`));
          results.push(status);
          continue;
        }

        await upsertProducts(items);
        await saveSnapshots(items.map(({ product_url, image_url, ...row }) => row));

        await logRun({ run_id: runId, platform: src.platform, category: cat.category, snapshot_date: snapshotDate,
          status, item_count: items.length, error: null, started_at: startedAt });
        console.log(`  ✅ ${items.length}개 저장 (${status})`);
        items.slice(0, 3).forEach(i => console.log(`  [${i.rank}] ${i.brand_name} | ${String(i.product_name).slice(0, 30)} | ${i.sale_price} ${i.currency}`));
        results.push(status);
      } catch (err) {
        console.error(`  ❌ 실패: ${err.message}`);
        await page.screenshot({ path: `debug/${src.platform}-${cat.category}.png`, fullPage: true }).catch(() => {});
        if (!DRY_RUN) await logRun({ run_id: runId, platform: src.platform, category: cat.category, snapshot_date: snapshotDate,
          status: 'failed', item_count: 0, error: err.message, started_at: startedAt });
        results.push('failed');
      }
    }
  }, { locale: src.platform === 'oy_global' ? 'en-US' : 'ko-KR' });

  return results;
}

async function main() {
  require('fs').mkdirSync('debug', { recursive: true });
  const runId = makeRunId();
  const snapshotDate = kstDate();
  const platforms = arg('platform') || Object.keys(SOURCES);
  const onlyCats = arg('category');
  console.log(`run_id=${runId} | 날짜(KST)=${snapshotDate} | 플랫폼=${platforms.join(', ')}`);

  const all = [];
  for (const p of platforms) {
    if (!SOURCES[p]) { console.error(`알 수 없는 플랫폼: ${p}`); all.push('failed'); continue; }
    all.push(...await runPlatform(SOURCES[p], runId, snapshotDate, onlyCats));
  }

  const failed = all.filter(s => s === 'failed').length;
  console.log(`\n완료: 성공 ${all.filter(s => s === 'success').length} / 부분 ${all.filter(s => s === 'partial').length} / 실패 ${failed}`);
  if (failed > 0) process.exit(1);   // Actions 에서 빨간불로 보이게
}

main().catch(err => { console.error(err); process.exit(1); });
