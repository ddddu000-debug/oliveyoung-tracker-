const { createClient } = require('@supabase/supabase-js');
const { brandKey } = require('./util');
require('dotenv').config();

let client;
function db() {
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return client;
}

// 같은 날짜·플랫폼·카테고리는 지우고 다시 넣는다 (같은 날 재실행해도 멱등)
async function saveSnapshots(items) {
  if (items.length === 0) return;
  const { snapshot_date, platform, category } = items[0];
  const { error: delErr } = await db().from('rk_snapshots').delete()
    .eq('snapshot_date', snapshot_date).eq('platform', platform).eq('category', category);
  if (delErr) throw new Error(`rk_snapshots 삭제 실패: ${delErr.message}`);

  for (let i = 0; i < items.length; i += 500) {
    const { error } = await db().from('rk_snapshots').insert(items.slice(i, i + 500));
    if (error) throw new Error(`rk_snapshots 저장 실패: ${error.message}`);
  }
}

// 상품 마스터 upsert. first_seen 은 기존 값이 더 이르면 유지.
async function upsertProducts(items) {
  if (items.length === 0) return;
  const platform = items[0].platform;
  const ids = [...new Set(items.map(i => i.product_id))];

  const existing = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db().from('rk_products').select('product_id, first_seen, last_seen')
      .eq('platform', platform).in('product_id', ids.slice(i, i + 200));
    if (error) throw new Error(`rk_products 조회 실패: ${error.message}`);
    data.forEach(r => existing.set(r.product_id, r));
  }

  const byId = new Map();
  for (const it of items) {
    const prev = existing.get(it.product_id);
    const d = it.snapshot_date;
    byId.set(it.product_id, {
      platform,
      product_id:   it.product_id,
      brand_name:   it.brand_name,
      brand_key:    brandKey(it.brand_name),
      product_name: it.product_name,
      product_url:  it.product_url || null,
      image_url:    it.image_url || null,
      first_seen:   prev && prev.first_seen < d ? prev.first_seen : d,
      last_seen:    prev && prev.last_seen > d ? prev.last_seen : d,
      updated_at:   new Date().toISOString(),
    });
  }
  const rows = [...byId.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from('rk_products').upsert(rows.slice(i, i + 500), { onConflict: 'platform,product_id' });
    if (error) throw new Error(`rk_products 저장 실패: ${error.message}`);
  }
}

async function logRun(row) {
  const { error } = await db().from('rk_scrape_runs').upsert(row, { onConflict: 'run_id,platform,category' });
  if (error) console.warn(`  ⚠️  rk_scrape_runs 기록 실패: ${error.message}`);
}

module.exports = { db, saveSnapshots, upsertProducts, logRun };
