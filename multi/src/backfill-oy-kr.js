// 기존 트래커의 raw_snapshots(읽기 전용)에서 국내 올리브영 이력을 새 테이블로 복사한다.
// 사용법: node src/backfill-oy-kr.js [--from=2026-07-01] [--to=2026-10-29]
//         node src/backfill-oy-kr.js --days=3   (최근 3일만 — 매일 동기화용)
// 기존 테이블에는 SELECT 만 한다. 같은 날짜·카테고리는 덮어쓰므로 여러 번 돌려도 안전.
const { db, saveSnapshots, upsertProducts } = require('./lib/db');
const { brandKey, kstDate } = require('./lib/util');

const CATEGORY_MAP = {
  skincare: 'skincare', bodycare: 'body', haircare: 'hair',
  makeup: 'makeup', maskpack: 'mask', cleansing: 'cleanser',
};

function arg(name, def) {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}

async function fetchOld(from, to) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    let q = db().from('raw_snapshots')
      .select('snapshot_date, collected_at, run_id, category, rank, product_name_raw, brand_name_raw, list_price, sale_price, price_discount_rate, product_url, badges, is_sold_out')
      .gte('snapshot_date', from)
      .order('snapshot_date').order('category').order('rank')
      .range(off, off + 999);
    if (to) q = q.lte('snapshot_date', to);
    const { data, error } = await q;
    if (error) throw new Error(`raw_snapshots 조회 실패: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const days = arg('days', null);
  const from = days ? kstDate(new Date(Date.now() - (Number(days) - 1) * 86400000)) : arg('from', '2026-07-01');
  const to = arg('to', null);
  const old = await fetchOld(from, to);
  console.log(`기존 raw_snapshots ${old.length}행 (${from} ~ ${to || '최신'})`);

  const groups = new Map();
  for (const r of old) {
    const category = CATEGORY_MAP[r.category];
    if (!category) continue;
    const key = `${r.snapshot_date}|${category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...r, category });
  }

  for (const [key, rows] of groups) {
    const seen = new Set();
    const items = rows
      .map(r => ({
        snapshot_date: r.snapshot_date,
        platform:      'oy_kr',
        category:      r.category,
        rank:          r.rank,
        product_id:    (r.product_url?.match(/goodsNo=([A-Z0-9]+)/) || [])[1]
                       || `name:${brandKey(r.brand_name_raw)}_${brandKey(r.product_name_raw)}`,
        brand_name:    r.brand_name_raw,
        product_name:  r.product_name_raw,
        currency:      'KRW',
        list_price:    r.list_price,
        sale_price:    r.sale_price,
        discount_rate: r.price_discount_rate,
        rating:        null,
        review_count:  null,
        badges:        [...(r.badges ? r.badges.split(',').filter(Boolean) : []), ...(r.is_sold_out ? ['품절'] : [])],
        raw:           null,
        run_id:        `backfill:${r.run_id || ''}`,
        collected_at:  r.collected_at || `${r.snapshot_date}T00:00:00Z`,
        product_url:   r.product_url,
      }))
      .filter(i => !seen.has(i.rank) && seen.add(i.rank));

    await upsertProducts(items);
    await saveSnapshots(items.map(({ product_url, ...row }) => row));
    console.log(`  ${key}: ${items.length}행`);
  }
  console.log(`✅ 백필 완료: ${groups.size}개 날짜·카테고리`);
}

main().catch(err => { console.error(err); process.exit(1); });
