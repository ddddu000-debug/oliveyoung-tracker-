// Supabase Keepalive — 가벼운 count 쿼리로 프로젝트를 "활동 중" 상태로 유지한다.
// 무료 플랜은 7일간 활동이 없으면 프로젝트를 자동 일시정지(pause)하므로,
// 스크래퍼(runner.js)가 며칠 실패하더라도 이 스크립트가 독립적으로 DB를 핑해 정지를 예방한다.
// 주의: 이미 정지된 프로젝트를 이 핑이 깨우지는 못한다(수동 Restore 필요). 어디까지나 "예방"용.
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function ping() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.error('❌ SUPABASE_URL / SUPABASE_KEY 환경변수가 없습니다.');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const MAX = 3;

  for (let attempt = 1; attempt <= MAX; attempt++) {
    // head:true → 실제 행은 안 받고 count만 조회 (가장 가벼운 읽기)
    const { count, error } = await supabase
      .from('raw_snapshots')
      .select('*', { count: 'exact', head: true });

    if (!error) {
      console.log(`✅ Supabase keepalive 성공 — raw_snapshots ${count}행 (활동 기록됨)`);
      return;
    }

    console.warn(`⚠️  keepalive 실패 (${attempt}/${MAX}): ${error.message}`);
    if (attempt < MAX) {
      const wait = attempt * 5000;   // 5초 → 10초 (일시적 워밍업/네트워크 blip 대비)
      console.log(`  ${wait / 1000}초 후 재시도...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  console.error('❌ Supabase keepalive 최종 실패 — 프로젝트가 이미 정지됐거나 자격증명 문제일 수 있음.');
  process.exit(1);
}

ping();
