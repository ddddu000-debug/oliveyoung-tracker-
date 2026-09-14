// ============================================================================
// verify-rls.js — RLS 잠금이 실제로 동작하는지 REST API 로 검증한다.
//
// 무엇을 하는가
//   1) SUPABASE_KEY 의 종류(anon / service_role)를 JWT role claim 으로 판별
//      → 키 값 자체는 출력하지 않는다.
//   2) anon 키로 3개 테이블에 SELECT / INSERT / UPDATE / DELETE 를 시도해
//      차단되는지 확인
//   3) service_role 키로 파이프라인이 쓰는 읽기 경로가 정상인지 확인
//
// 안전성
//   · INSERT 테스트는 일부러 잘못된 날짜값('not-a-date')을 보낸다.
//     Postgres 는 권한을 먼저 검사하므로
//       - 권한 없음(42501)  → 차단 확인, 아무것도 안 써짐  ✅
//       - 타입 오류(22007) → 권한이 열려 있다는 뜻, 그래도 안 써짐 ⚠️
//     어느 쪽이든 DB 에 행이 추가되지 않는다.
//   · UPDATE / DELETE 테스트는 절대 매칭되지 않는 필터(1900-01-01)를 쓴다.
//
// 사용법 (PowerShell)
//   $env:SUPABASE_URL="https://xxxx.supabase.co"
//   $env:SUPABASE_ANON_KEY="<anon key>"
//   $env:SUPABASE_SERVICE_KEY="<service_role key>"   # 선택
//   node scripts/verify-rls.js
// ============================================================================
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TABLES = ['raw_snapshots', 'daily_changes', 'brand_entries'];
const SENTINEL_DATE = '1900-01-01';

// JWT 의 role claim 만 꺼낸다 (키는 출력하지 않는다)
function keyRole(key) {
  if (!key) return '(없음)';
  if (key.startsWith('sb_publishable_')) return 'publishable (신형 anon)';
  if (key.startsWith('sb_secret_'))      return 'secret (신형 service_role)';
  const parts = key.split('.');
  if (parts.length !== 3) return '(형식 불명)';
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.role || '(role claim 없음)';
  } catch {
    return '(디코드 실패)';
  }
}

// permission denied 계열인지 판별
function isDenied(error) {
  if (!error) return false;
  const code = error.code || '';
  const msg  = (error.message || '').toLowerCase();
  return code === '42501' || code === 'PGRST301' || msg.includes('permission denied');
}

function mark(ok) { return ok ? '✅ 차단됨' : '⚠️  차단 안 됨'; }

async function probeAnon(url, anonKey) {
  console.log('\n── anon 키 접근 시도 (전부 차단되어야 정상) ──────────────────');
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  let allBlocked = true;

  for (const table of TABLES) {
    const results = [];

    // SELECT — 차단되면 error, 정책만 없고 grant 가 남아 있으면 빈 배열
    const sel = await sb.from(table).select('*').limit(1);
    const selBlocked = isDenied(sel.error);
    const selEmpty   = !sel.error && (sel.data || []).length === 0;
    results.push(['SELECT', selBlocked ? '✅ 차단됨(권한없음)'
                        : selEmpty     ? '✅ 0행(RLS 차단)'
                                       : `⚠️  ${sel.data.length}행 조회됨`]);
    if (!selBlocked && !selEmpty) allBlocked = false;

    // INSERT — 잘못된 날짜값. 42501 이면 권한 차단, 22007 이면 권한이 열려 있음
    const ins = await sb.from(table).insert({ snapshot_date: 'not-a-date' });
    const insBlocked = isDenied(ins.error);
    results.push(['INSERT', insBlocked ? '✅ 차단됨'
                        : ins.error    ? `⚠️  권한통과·다른오류(${ins.error.code})`
                                       : '🚨 성공함(즉시 조치 필요)']);
    if (!insBlocked) allBlocked = false;

    // UPDATE — 매칭 0건 필터
    const upd = await sb.from(table).update({ snapshot_date: SENTINEL_DATE })
                        .eq('snapshot_date', SENTINEL_DATE);
    const updBlocked = isDenied(upd.error);
    results.push(['UPDATE', mark(updBlocked)]);
    if (!updBlocked) allBlocked = false;

    // DELETE — 매칭 0건 필터
    const del = await sb.from(table).delete().eq('snapshot_date', SENTINEL_DATE);
    const delBlocked = isDenied(del.error);
    results.push(['DELETE', mark(delBlocked)]);
    if (!delBlocked) allBlocked = false;

    console.log(`\n  [${table}]`);
    results.forEach(([op, r]) => console.log(`    ${op.padEnd(7)} ${r}`));
  }
  return allBlocked;
}

async function probeService(url, svcKey) {
  console.log('\n── service_role 키 — 파이프라인 읽기 경로 확인 ────────────────');
  const sb = createClient(url, svcKey, { auth: { persistSession: false } });
  let ok = true;
  for (const table of TABLES) {
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (error) { console.log(`  [${table}] ❌ 실패: ${error.message}`); ok = false; }
    else       { console.log(`  [${table}] ✅ count=${count}`); }
  }
  return ok;
}

async function main() {
  const url     = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const svcKey  = process.env.SUPABASE_SERVICE_KEY;
  const appKey  = process.env.SUPABASE_KEY;

  if (!url) { console.error('❌ SUPABASE_URL 이 없습니다.'); process.exit(1); }

  console.log('=== 키 종류 판별 (키 값은 출력하지 않습니다) ===');
  console.log(`  SUPABASE_KEY (파이프라인이 쓰는 키) : ${keyRole(appKey)}`);
  console.log(`  SUPABASE_ANON_KEY                   : ${keyRole(anonKey)}`);
  console.log(`  SUPABASE_SERVICE_KEY                : ${keyRole(svcKey)}`);

  let anonOk = null, svcOk = null;
  if (anonKey) anonOk = await probeAnon(url, anonKey);
  else console.log('\n(SUPABASE_ANON_KEY 없음 — anon 차단 검증 건너뜀)');

  if (svcKey) svcOk = await probeService(url, svcKey);
  else console.log('\n(SUPABASE_SERVICE_KEY 없음 — 서버 경로 검증 건너뜀)');

  console.log('\n=== 요약 ===');
  console.log(`  anon 전면 차단     : ${anonOk === null ? '미검증' : anonOk ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  service_role 정상  : ${svcOk  === null ? '미검증' : svcOk  ? '✅ PASS' : '❌ FAIL'}`);

  if (anonOk === false || svcOk === false) process.exit(1);
}

main().catch(err => { console.error(`❌ 검증 실패: ${err.message}`); process.exit(1); });
