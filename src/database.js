const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

// ── raw_snapshots 저장 ────────────────────────────────────────────────
async function saveRawSnapshots(products) {
  console.log('\n[DB] raw_snapshots 저장 중...');
  const supabase = getClient();

  const today    = products[0]?.snapshot_date;
  const category = products[0]?.category;

  // 중복 확인
  const { data: existing } = await supabase
    .from('raw_snapshots')
    .select('id')
    .eq('snapshot_date', today)
    .eq('category', category)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`  ⚠️  ${today} [${category}] 데이터가 이미 있어요. 건너뜀.`);
    return false;
  }

  const rows = products.map(p => ({
    snapshot_date:         p.snapshot_date,
    collected_at:          p.collected_at,
    run_id:                p.run_id,
    category:              p.category,
    rank:                  p.rank,
    product_name_raw:      p.product_name_raw,
    brand_name_raw:        p.brand_name_raw,
    list_price:            p.list_price,
    sale_price:            p.sale_price,
    price_discount_amount: p.price_discount_amount,
    price_discount_rate:   p.price_discount_rate,
    product_url:           p.product_url,
    badges:                p.badges,
    is_sold_out:           p.is_sold_out,
    has_otuk:              p.has_otuk,
    source_url:            p.source_url,
  }));

  const { error } = await supabase.from('raw_snapshots').insert(rows);
  if (error) throw new Error(`raw_snapshots 저장 실패: ${error.message}`);

  console.log(`  ✅ ${products.length}개 저장 완료 (${today})`);
  return true;
}

// ── daily_changes 저장 ────────────────────────────────────────────────
async function saveDailyChanges(changes) {
  console.log('\n[DB] daily_changes 저장 중...');
  const supabase = getClient();

  const today = changes[0]?.snapshot_date;

  const { data: existing } = await supabase
    .from('daily_changes')
    .select('id')
    .eq('snapshot_date', today)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`  ⚠️  ${today} 이미 있어요. 건너뜀.`);
    return;
  }

  const rows = changes.map(c => ({
    snapshot_date:       c.snapshot_date,
    product_key:         c.product_key,
    brand_key:           c.brand_key,
    today_rank:          c.today_rank,
    yesterday_rank:      c.yesterday_rank,
    rank_change:         c.rank_change,
    today_sale_price:    c.today_sale_price,
    yesterday_sale_price: c.yesterday_sale_price,
    price_change:        c.price_change,
    price_change_rate:   c.price_change_rate,
    is_new_entry:        c.is_new_entry,
    is_reentry:          c.is_reentry,
    is_price_changed:    c.is_price_changed,
  }));

  const { error } = await supabase.from('daily_changes').insert(rows);
  if (error) throw new Error(`daily_changes 저장 실패: ${error.message}`);

  console.log(`  ✅ ${changes.length}개 저장 완료`);
}

// ── brand_entries 저장 ────────────────────────────────────────────────
async function saveBrandEntries(entries) {
  console.log('\n[DB] brand_entries 저장 중...');
  const supabase = getClient();

  if (entries.length === 0) {
    console.log('  신규 진입 브랜드 없음');
    return;
  }

  const rows = entries.map(e => ({
    snapshot_date:  e.snapshot_date,
    brand_key:      e.brand_key,
    brand_name_raw: e.brand_name_raw,
    is_new_entry:   e.is_new_entry,
    is_reentry:     e.is_reentry,
    entry_rank:     e.entry_rank,
  }));

  const { error } = await supabase.from('brand_entries').insert(rows);
  if (error) throw new Error(`brand_entries 저장 실패: ${error.message}`);

  console.log(`  ✅ ${entries.length}개 브랜드 기록됨`);
}

// ── 대시보드용 데이터 읽기 ────────────────────────────────────────────
async function fetchAllSnapshots() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('raw_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: true })
    .order('category')
    .order('rank');
  if (error) throw new Error(`raw_snapshots 읽기 실패: ${error.message}`);
  return data || [];
}

async function fetchAllChanges() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('daily_changes')
    .select('*')
    .order('snapshot_date', { ascending: true });
  if (error) throw new Error(`daily_changes 읽기 실패: ${error.message}`);
  return data || [];
}

// ── analyzer용: 어제 raw_snapshots 읽기 ──────────────────────────────
async function fetchYesterdaySnapshots(category) {
  const supabase = getClient();

  // 하루 최대 100개 * 여유분 → 고유 날짜 2개를 확보하기 위해 300행 조회 후 JS에서 중복 제거
  const { data: rows } = await supabase
    .from('raw_snapshots')
    .select('snapshot_date')
    .eq('category', category)
    .order('snapshot_date', { ascending: false })
    .limit(300);

  if (!rows || rows.length === 0) return [];

  // 중복 제거 후 날짜 목록 (내림차순)
  const distinctDates = [...new Set(rows.map(r => r.snapshot_date))];
  if (distinctDates.length < 2) return [];          // 아직 하루치 데이터만 있음

  const yesterday = distinctDates[1];               // 두 번째 고유 날짜 = 어제

  const { data, error } = await supabase
    .from('raw_snapshots')
    .select('*')
    .eq('category', category)
    .eq('snapshot_date', yesterday)
    .order('rank');

  if (error) throw new Error(`어제 데이터 읽기 실패: ${error.message}`);
  return data || [];
}

module.exports = {
  saveRawSnapshots,
  saveDailyChanges,
  saveBrandEntries,
  fetchAllSnapshots,
  fetchAllChanges,
  fetchYesterdaySnapshots,
};
