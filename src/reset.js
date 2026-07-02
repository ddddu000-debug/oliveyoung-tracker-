// DB 전체 초기화 스크립트 — 3개 테이블(raw_snapshots, daily_changes, brand_entries)의
// 모든 행을 삭제한다. 오늘 기준으로 "새 기준(모든 카테고리 getBestList 랭킹)"으로
// 누적을 새로 시작하기 위한 일회성 리셋용.
//
// ⚠️ 되돌릴 수 없는 삭제. 실수 방지를 위해 환경변수 CONFIRM_RESET=YES 일 때만 동작.
// 사용: CONFIRM_RESET=YES node src/reset.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TABLES = ['daily_changes', 'brand_entries', 'raw_snapshots'];

async function countRows(supabase, table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table} count 실패: ${error.message}`);
  return count;
}

async function reset() {
  if (process.env.CONFIRM_RESET !== 'YES') {
    console.error('❌ 안전장치: CONFIRM_RESET=YES 가 설정되지 않아 중단합니다.');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) { console.error('❌ SUPABASE_URL / SUPABASE_KEY 없음'); process.exit(1); }

  const supabase = createClient(url, key);

  console.log('=== 삭제 전 행 수 ===');
  for (const t of TABLES) console.log(`  ${t}: ${await countRows(supabase, t)}행`);

  for (const t of TABLES) {
    // 모든 행 삭제 — PostgREST는 필터 없는 delete를 막으므로 전 날짜를 포함하는 조건을 준다.
    const { error } = await supabase.from(t).delete().gte('snapshot_date', '0001-01-01');
    if (error) throw new Error(`${t} 삭제 실패: ${error.message}`);
    console.log(`🗑️  ${t} 전체 삭제 완료`);
  }

  console.log('=== 삭제 후 행 수 ===');
  let ok = true;
  for (const t of TABLES) {
    const c = await countRows(supabase, t);
    console.log(`  ${t}: ${c}행`);
    if (c !== 0) ok = false;
  }

  if (!ok) { console.error('❌ 일부 테이블이 비워지지 않았습니다.'); process.exit(1); }
  console.log('✅ DB 초기화 완료 — 이제 오늘 수집분이 1일차로 적립됩니다.');
}

reset().catch(err => { console.error(`❌ 초기화 실패: ${err.message}`); process.exit(1); });
