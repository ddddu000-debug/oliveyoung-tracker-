// ============================================================================
// rehearse-rls-migration.js
//
// supabase/migrations/20260910120000_enable_rls_lockdown.sql 을
// 일회용 인메모리 Postgres(PGlite) 위에서 실제로 실행해 검증한다.
// 프로덕션 DB 에 붙여넣기 전에 문법·권한·파이프라인 영향을 전부 확인하는 용도.
//
// 무엇을 검증하는가
//   1. Supabase 기본 상태(RLS off + anon/authenticated 에 ALL)를 재현하고
//      변경 전 anon 이 실제로 뚫려 있음을 확인 (= 이 migration 이 필요한 이유)
//   2. migration 을 실행 (문법·DO 블록·SAFETY GUARD)
//   3. 변경 후 anon / authenticated 가 3개 테이블 × SIUD 전부 차단되는지
//   4. service_role 로 실제 파이프라인 호출 패턴 12종이 그대로 동작하는지
//   5. supabase/checks/02_post_verify.sql 이 전부 PASS 를 내는지
//   6. rollback 스크립트가 정상 동작하는지
//
// 실행
//   npm i -D @electric-sql/pglite     (최초 1회)
//   npm run rehearse:rls
//
// 주의
//   · 순수 인메모리 인스턴스다. 실제 Supabase 에 접속하지 않고 어떤 파일도 쓰지 않는다.
//   · 테이블 스키마는 src/database.js 가 INSERT 하는 컬럼을 기준으로 재현한 것이며
//     프로덕션 스키마와 1:1 이 아니다. 검증 대상은 데이터가 아니라 "권한"이다.
// ============================================================================
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const MIGRATION = path.join(REPO, 'supabase/migrations/20260910120000_enable_rls_lockdown.sql');
const VERIFY    = path.join(REPO, 'supabase/checks/02_post_verify.sql');
const ROLLBACK  = path.join(REPO, 'supabase/rollback/20260910120000_enable_rls_lockdown_rollback.sql');

const TABLES = ['raw_snapshots', 'daily_changes', 'brand_entries'];
const ok  = (s) => '  [OK]   ' + s;
const bad = (s) => '  [FAIL] ' + s;

async function loadPGlite() {
  // pglite 는 exports 맵이 있어 dist 하위 경로 직접 지정이 막힌다.
  // 패키지 지정자로 CJS 빌드를 먼저 시도하고, 실패하면 ESM 으로 넘어간다.
  try {
    const m = require('@electric-sql/pglite');
    if (m && m.PGlite) return m.PGlite;
  } catch (e) { /* ESM 경로로 재시도 */ }
  try {
    const m = await import('@electric-sql/pglite');
    if (m && m.PGlite) return m.PGlite;
  } catch (e) { /* 아래에서 안내 */ }
  console.error('❌ @electric-sql/pglite 를 찾을 수 없습니다.');
  console.error('   먼저 설치하세요:  npm i -D @electric-sql/pglite');
  process.exit(1);
}

async function main() {
  const PGlite = await loadPGlite();
  const db = new PGlite();                 // 인메모리 전용
  await db.waitReady;
  console.log('PGlite 기동 완료 (in-memory)\n');

  // ── 1. Supabase 기본 상태 재현 ──────────────────────────────────────────
  console.log('[SETUP] Supabase 기본 상태 재현 (RLS off + anon/authenticated 에 ALL)');
  await db.exec(`
    create role anon           nologin noinherit;
    create role authenticated  nologin noinherit;
    create role service_role   nologin noinherit bypassrls;

    grant usage on schema public to anon, authenticated, service_role;

    create table public.raw_snapshots (
      id bigint generated always as identity primary key,
      snapshot_date date, collected_at timestamptz, run_id text, category text,
      rank int, product_name_raw text, brand_name_raw text,
      list_price int, sale_price int, price_discount_amount int, price_discount_rate numeric,
      product_url text, badges text, is_sold_out boolean, has_otuk boolean, source_url text
    );
    create table public.daily_changes (
      id bigint generated always as identity primary key,
      snapshot_date date, product_key text, brand_key text,
      today_rank int, yesterday_rank int, rank_change int,
      today_sale_price int, yesterday_sale_price int, price_change int, price_change_rate numeric,
      is_new_entry boolean, is_reentry boolean, is_price_changed boolean
    );
    create table public.brand_entries (
      id bigint generated always as identity primary key,
      snapshot_date date, brand_key text, brand_name_raw text,
      is_new_entry boolean, is_reentry boolean, entry_rank int
    );

    grant all on table public.raw_snapshots, public.daily_changes, public.brand_entries
      to anon, authenticated, service_role;
    grant usage, select on all sequences in schema public to anon, authenticated, service_role;

    insert into public.raw_snapshots (snapshot_date, category, rank, brand_name_raw, product_name_raw)
      values ('2026-09-10','skincare',1,'브랜드A','상품A'),
             ('2026-09-10','skincare',2,'브랜드B','상품B');
    insert into public.daily_changes (snapshot_date, product_key, brand_key, today_rank)
      values ('2026-09-10','k1','브랜드A',1);
    insert into public.brand_entries (snapshot_date, brand_key, brand_name_raw, entry_rank)
      values ('2026-09-10','브랜드B','브랜드B',2);
  `);
  console.log(ok('테이블 3개 + 역할 3개 생성, 초기 데이터 적재'));

  // ── 2. 변경 전 anon 취약 상태 확인 ──────────────────────────────────────
  console.log('\n[BEFORE] 변경 전 anon 접근 — 이 migration 이 필요한 이유');
  let beforeOpen = 0;
  const beforeProbes = [
    ['SELECT', 'select count(*) from public.raw_snapshots'],
    ['INSERT', "insert into public.raw_snapshots (snapshot_date, category, rank) values ('2026-01-01','x',99)"],
    ['UPDATE', "update public.raw_snapshots set rank = 0 where category = 'x'"],
    ['DELETE', "delete from public.raw_snapshots where category = 'x'"],
  ];
  for (const [label, sql] of beforeProbes) {
    await db.exec('set role anon;');
    try { await db.query(sql); console.log(bad('anon ' + label + ' 성공  <-- 취약')); beforeOpen++; }
    catch (e) { console.log(ok('anon ' + label + ' 차단')); }
    await db.exec('reset role;');
  }

  // ── 3. MIGRATION 적용 ───────────────────────────────────────────────────
  console.log('\n[MIGRATION] ' + path.basename(MIGRATION));
  try {
    await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
    console.log(ok('실행 성공 (문법 · DO 블록 · SAFETY GUARD 정상)'));
  } catch (e) {
    console.log(bad('실행 실패: ' + e.message));
    process.exit(1);
  }

  // ── 4. anon / authenticated 차단 확인 ───────────────────────────────────
  console.log('\n[AFTER] anon 접근 (3테이블 × SELECT/INSERT/UPDATE/DELETE)');
  let anonBlocked = 0, anonTotal = 0;
  for (const tbl of TABLES) {
    const probes = [
      ['SELECT', 'select count(*) from public.' + tbl],
      ['INSERT', "insert into public." + tbl + " (snapshot_date) values ('2026-01-01')"],
      ['UPDATE', "update public." + tbl + " set snapshot_date = '2026-01-02' where snapshot_date = '2026-01-01'"],
      ['DELETE', "delete from public." + tbl + " where snapshot_date = '2026-01-01'"],
    ];
    for (const [label, sql] of probes) {
      anonTotal++;
      await db.exec('set role anon;');
      try {
        await db.query(sql);
        console.log(bad('anon ' + tbl + '.' + label + ' 성공  <-- 차단 실패'));
      } catch (e) {
        const denied = /permission denied/i.test(e.message.split('\n')[0]);
        console.log(denied ? ok('anon ' + tbl + '.' + label + ' 차단 (permission denied)')
                           : bad('anon ' + tbl + '.' + label + ' 다른오류: ' + e.message.split('\n')[0]));
        if (denied) anonBlocked++;
      }
      await db.exec('reset role;');
    }
  }

  console.log('\n[AFTER] authenticated 접근');
  let authBlocked = 0;
  for (const tbl of TABLES) {
    await db.exec('set role authenticated;');
    try { await db.query('select count(*) from public.' + tbl); console.log(bad('authenticated ' + tbl + '.SELECT 성공  <-- 차단 실패')); }
    catch (e) { console.log(ok('authenticated ' + tbl + '.SELECT 차단')); authBlocked++; }
    await db.exec('reset role;');
  }

  // ── 5. service_role 파이프라인 재현 ─────────────────────────────────────
  console.log('\n[AFTER] service_role — 실제 파이프라인 호출 패턴 재현');
  const svcSteps = [
    ['keepalive.js  count 조회',       'select count(*) from public.raw_snapshots'],
    ['database.js   raw 당일 삭제',    "delete from public.raw_snapshots where snapshot_date='2026-09-10' and category='skincare'"],
    ['database.js   raw INSERT',       "insert into public.raw_snapshots (snapshot_date,category,rank,brand_name_raw,product_name_raw) values ('2026-09-10','skincare',1,'브랜드A','재삽입')"],
    ['database.js   어제 날짜 조회',    "select snapshot_date from public.raw_snapshots where category='skincare' order by snapshot_date desc limit 300"],
    ['runner.js     과거 브랜드 조회',  "select brand_name_raw from public.raw_snapshots where category='skincare' and snapshot_date < '2026-09-11' limit 1000"],
    ['database.js   daily 당일 삭제',   "delete from public.daily_changes where snapshot_date='2026-09-10'"],
    ['database.js   daily INSERT',      "insert into public.daily_changes (snapshot_date,product_key,brand_key,today_rank) values ('2026-09-10','k1','브랜드A',1)"],
    ['database.js   brand 당일 삭제',   "delete from public.brand_entries where snapshot_date='2026-09-10'"],
    ['database.js   brand INSERT',      "insert into public.brand_entries (snapshot_date,brand_key,brand_name_raw,entry_rank) values ('2026-09-10','브랜드B','브랜드B',2)"],
    ['report.js     전체 스냅샷 조회',  'select * from public.raw_snapshots order by snapshot_date, category, rank limit 1000'],
    ['report.js     전체 변동 조회',    'select * from public.daily_changes order by snapshot_date limit 1000'],
    ['reset.js      전량 삭제 패턴',    "select count(*) from public.brand_entries where snapshot_date >= '0001-01-01'"],
  ];
  let svcPass = 0;
  for (const [name, sql] of svcSteps) {
    await db.exec('set role service_role;');
    try { await db.query(sql); console.log(ok('service_role · ' + name)); svcPass++; }
    catch (e) { console.log(bad('service_role · ' + name + ' — ' + e.message.split('\n')[0])); }
    await db.exec('reset role;');
  }

  // ── 6. 검증 쿼리 ────────────────────────────────────────────────────────
  console.log('\n[VERIFY] ' + path.basename(VERIFY));
  let rows;
  try {
    rows = (await db.query(fs.readFileSync(VERIFY, 'utf8'))).rows;
    console.log(ok('문법 정상 — ' + rows.length + '행 반환'));
  } catch (e) {
    console.log(bad('검증 쿼리 실패: ' + e.message));
    process.exit(1);
  }
  console.log('');
  console.log('  ' + 'check_name'.padEnd(23) + 'subject'.padEnd(24) + 'result'.padEnd(26) + 'expected'.padEnd(26) + 'verdict');
  console.log('  ' + '-'.repeat(112));
  let fails = 0;
  for (const r of rows) {
    if (r.verdict === 'FAIL') fails++;
    console.log('  ' + String(r.check_name).padEnd(23) + String(r.subject).padEnd(24) +
                String(r.result).padEnd(26) + String(r.expected).padEnd(26) + r.verdict);
  }

  // ── 7. 롤백 ─────────────────────────────────────────────────────────────
  console.log('\n[ROLLBACK] ' + path.basename(ROLLBACK));
  let rollbackOk = false;
  try {
    await db.exec(fs.readFileSync(ROLLBACK, 'utf8'));
    const back = await db.query(
      "select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace" +
      " where n.nspname='public' and c.relname in ('raw_snapshots','daily_changes','brand_entries')"
    );
    rollbackOk = back.rows.length === 3 && back.rows.every((r) => r.relrowsecurity === false);
    console.log(rollbackOk ? ok('롤백 정상 — RLS 3개 모두 해제') : bad('롤백 후에도 RLS 가 남아 있음'));
  } catch (e) {
    console.log(bad('롤백 실패: ' + e.message));
  }

  await db.close();

  // ── 요약 ────────────────────────────────────────────────────────────────
  const pass =
    beforeOpen === 4 &&
    anonBlocked === anonTotal &&
    authBlocked === TABLES.length &&
    svcPass === svcSteps.length &&
    fails === 0 &&
    rollbackOk;

  console.log('\n======== 리허설 요약 ========');
  console.log('  변경 전 anon 취약 재현   : ' + beforeOpen + '/4');
  console.log('  변경 후 anon 차단        : ' + anonBlocked + '/' + anonTotal);
  console.log('  변경 후 authenticated 차단: ' + authBlocked + '/' + TABLES.length);
  console.log('  service_role 파이프라인  : ' + svcPass + '/' + svcSteps.length);
  console.log('  검증쿼리 FAIL            : ' + fails);
  console.log('  롤백 동작                : ' + (rollbackOk ? 'PASS' : 'FAIL'));
  console.log('  최종                     : ' + (pass ? 'PASS' : 'FAIL'));

  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('리허설 오류:', e); process.exit(1); });
