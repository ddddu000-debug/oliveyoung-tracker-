// Google Sheets → Supabase 데이터 이전 스크립트 (1회용)
const { getSheets, readSheet } = require('./sheets');
const { createClient }         = require('@supabase/supabase-js');
require('dotenv').config();

function toObj(headers, row) {
  const o = {};
  headers.forEach((h, i) => o[h] = row[i] ?? '');
  return o;
}

function parseBool(v) {
  if (v === true || v === 'TRUE' || v === 'true' || v === '1') return true;
  if (v === false || v === 'FALSE' || v === 'false' || v === '0') return false;
  return null;
}

function parseNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function parseDate(v) {
  if (!v) return null;
  return v; // YYYY-MM-DD 문자열 그대로
}

async function migrate() {
  console.log('Google Sheets → Supabase 데이터 이전 시작...\n');

  const sheets   = await getSheets();
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  // ── 1. raw_snapshots ────────────────────────────────────────────────
  console.log('[1/3] raw_snapshots 읽는 중...');
  const rawRows = await readSheet(sheets, 'raw_snapshots');
  if (rawRows.length > 1) {
    const headers = rawRows[0];
    const rows    = rawRows.slice(1).map(r => toObj(headers, r));

    const data = rows.map(r => ({
      snapshot_date:         parseDate(r.snapshot_date),
      collected_at:          r.collected_at || null,
      run_id:                r.run_id || null,
      category:              r.category,
      rank:                  parseInt(r.rank) || null,
      product_name_raw:      r.product_name_raw,
      brand_name_raw:        r.brand_name_raw,
      list_price:            parseInt(r.list_price) || null,
      sale_price:            parseInt(r.sale_price) || null,
      price_discount_amount: parseInt(r.price_discount_amount) || null,
      price_discount_rate:   parseNum(r.price_discount_rate),
      product_url:           r.product_url,
      badges:                r.badges,
      is_sold_out:           parseBool(r.is_sold_out),
      has_otuk:              parseBool(r.has_otuk),
      source_url:            r.source_url,
    })).filter(r => r.snapshot_date && r.category);

    // 100개씩 나눠서 저장
    for (let i = 0; i < data.length; i += 100) {
      const chunk = data.slice(i, i + 100);
      const { error } = await supabase.from('raw_snapshots').upsert(chunk, {
        onConflict: 'snapshot_date,category,rank',
        ignoreDuplicates: true,
      });
      if (error) console.error(`  ❌ 오류: ${error.message}`);
      else console.log(`  ✅ raw_snapshots ${i + chunk.length}/${data.length}개 완료`);
    }
  } else {
    console.log('  데이터 없음');
  }

  // ── 2. daily_changes ────────────────────────────────────────────────
  console.log('\n[2/3] daily_changes 읽는 중...');
  const changeRows = await readSheet(sheets, 'daily_changes');
  if (changeRows.length > 1) {
    const headers = changeRows[0];
    const rows    = changeRows.slice(1).map(r => toObj(headers, r));

    const data = rows.map(r => ({
      snapshot_date:        parseDate(r.snapshot_date),
      product_key:          r.product_key,
      brand_key:            r.brand_key,
      today_rank:           parseInt(r.today_rank) || null,
      yesterday_rank:       parseInt(r.yesterday_rank) || null,
      rank_change:          parseInt(r.rank_change) || null,
      today_sale_price:     parseInt(r.today_sale_price) || null,
      yesterday_sale_price: parseInt(r.yesterday_sale_price) || null,
      price_change:         parseInt(r.price_change) || null,
      price_change_rate:    parseNum(r.price_change_rate),
      is_new_entry:         parseBool(r.is_new_entry),
      is_reentry:           parseBool(r.is_reentry),
      is_price_changed:     parseBool(r.is_price_changed),
    })).filter(r => r.snapshot_date);

    for (let i = 0; i < data.length; i += 100) {
      const chunk = data.slice(i, i + 100);
      const { error } = await supabase.from('daily_changes').insert(chunk);
      if (error) console.error(`  ❌ 오류: ${error.message}`);
      else console.log(`  ✅ daily_changes ${i + chunk.length}/${data.length}개 완료`);
    }
  } else {
    console.log('  데이터 없음');
  }

  // ── 3. brand_entries ────────────────────────────────────────────────
  console.log('\n[3/3] brand_entries 읽는 중...');
  const brandRows = await readSheet(sheets, 'brand_entries');
  if (brandRows.length > 1) {
    const headers = brandRows[0];
    const rows    = brandRows.slice(1).map(r => toObj(headers, r));

    const data = rows.map(r => ({
      snapshot_date:  parseDate(r.snapshot_date),
      brand_key:      r.brand_key,
      brand_name_raw: r.brand_name_raw,
      is_new_entry:   parseBool(r.is_new_entry),
      is_reentry:     parseBool(r.is_reentry),
      entry_rank:     parseInt(r.entry_rank) || null,
    })).filter(r => r.snapshot_date);

    for (let i = 0; i < data.length; i += 100) {
      const chunk = data.slice(i, i + 100);
      const { error } = await supabase.from('brand_entries').insert(chunk);
      if (error) console.error(`  ❌ 오류: ${error.message}`);
      else console.log(`  ✅ brand_entries ${i + chunk.length}/${data.length}개 완료`);
    }
  } else {
    console.log('  데이터 없음');
  }

  console.log('\n✅ 이전 완료!');
}

migrate().catch(err => { console.error('❌ 실패:', err.message); process.exit(1); });
