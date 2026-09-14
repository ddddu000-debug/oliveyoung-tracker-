-- ============================================================================
-- 20260910120000_enable_rls_lockdown.sql
--
-- 목적 : public.raw_snapshots / daily_changes / brand_entries 의
--        "RLS Disabled in Public" (Supabase Security Advisor · Critical) 해소
--
-- 전략 : Option A — 서버 전용 접근 (Server-only, service_role)
--        이 프로젝트의 DB 접근은 100% GitHub Actions 안의 Node.js 프로세스이며
--        브라우저/클라이언트에서 Supabase 를 호출하는 코드가 한 줄도 없다.
--        (GitHub Pages 산출물은 report.js 가 빌드 타임에 데이터를 구워 넣은 정적 HTML)
--        따라서 anon / authenticated 에게는 어떤 권한도 필요하지 않다.
--
-- 결과 : - RLS ON  → Security Advisor 오류 해소
--        - Policy 0개 → anon/authenticated 는 정책이 없으므로 전면 차단
--        - GRANT 회수 → 정책 이전에 테이블 권한 자체가 없음 (2중 방어)
--        - service_role 은 rolbypassrls 로 RLS 를 우회하므로 파이프라인 무영향
--
-- ⚠️ 전제조건 (반드시 확인) --------------------------------------------------
--    GitHub Secrets 의 SUPABASE_KEY 가 **service_role 키**여야 한다.
--    anon 키인 상태로 이 migration 을 적용하면 수집/저장/리포트가 전부 실패한다.
--    확인 방법은 supabase/checks/README 또는 scripts/verify-rls.js 참조.
-- ============================================================================

begin;

-- ── 0. 안전장치 (SAFETY GUARD) ───────────────────────
-- RLS 를 켜도 파이프라인이 살아 있는 근거는 딱 하나 — service_role 의 BYPASSRLS 속성이다.
-- 이 속성이 없는 상태에서 RLS 를 켜면 수집·저장·리포트·keepalive 가 전부 죽는다.
-- 따라서 먼저 검사하고, 없으면 트랜잭션 전체를 중단시킨다 (아무것도 변경되지 않음).
do $guard$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'service_role' and rolbypassrls
  ) then
    raise exception
      'ABORT: service_role 에 BYPASSRLS 가 없습니다. RLS 를 켜면 파이프라인이 중단되므로 적용을 중단합니다.';
  end if;

  if (select count(*) from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in ('raw_snapshots','daily_changes','brand_entries')) <> 3 then
    raise exception 'ABORT: public 스키마에서 대상 테이블 3개를 모두 찾지 못했습니다.';
  end if;

  raise notice 'SAFETY GUARD 통과 — service_role BYPASSRLS 확인, 대상 테이블 3개 확인';
end
$guard$;

-- ── 1. RLS 활성화 (Advisor 오류의 직접 원인) ────────────────────────────────
alter table public.raw_snapshots enable row level security;
alter table public.daily_changes enable row level security;
alter table public.brand_entries enable row level security;

-- Policy 는 의도적으로 하나도 만들지 않는다.
-- RLS ON + Policy 0개 = anon/authenticated 전면 거부, service_role 은 우회.
-- `using (true)` 류의 전면 허용 정책은 RLS 를 켜는 의미를 없애므로 금지.

-- ── 2. 테이블 GRANT 회수 (defense in depth) ────────────────────────────────
-- Supabase 기본값은 신규 테이블에 anon/authenticated 로 ALL 을 부여한다.
-- RLS 만으로도 차단되지만, 훗날 누가 정책을 하나 잘못 추가해도 새지 않도록
-- 권한 자체를 회수한다. 이 3개 테이블은 클라이언트가 쓸 일이 전혀 없다.
revoke all on table public.raw_snapshots from anon, authenticated;
revoke all on table public.daily_changes from anon, authenticated;
revoke all on table public.brand_entries from anon, authenticated;

-- ── 3. 시퀀스 GRANT 회수 ────────────────────────────────────────────────────
-- identity/serial 컬럼의 시퀀스에 USAGE 가 남아 있으면 INSERT 경로가 일부 열린다.
-- 위 3개 테이블에 종속된 시퀀스만 정확히 골라 회수한다 (다른 객체는 건드리지 않음).
do $$
declare
  seq_name text;
begin
  for seq_name in
    select distinct quote_ident(ns.nspname) || '.' || quote_ident(s.relname)
    from pg_class s
    join pg_namespace ns on ns.oid = s.relnamespace
    join pg_depend d  on d.objid = s.oid
                     and d.classid = 'pg_class'::regclass
                     and d.deptype in ('a','i')
    join pg_class t   on t.oid = d.refobjid
    join pg_namespace tn on tn.oid = t.relnamespace
    where s.relkind = 'S'
      and tn.nspname = 'public'
      and t.relname in ('raw_snapshots','daily_changes','brand_entries')
  loop
    execute format('revoke all on sequence %s from anon, authenticated', seq_name);
    raise notice 'revoked sequence: %', seq_name;
  end loop;
end
$$;

-- ── 4. service_role 권한 보장 ───────────────────────────────────────────────
-- 이미 부여돼 있는 것이 정상이지만, 멱등성을 위해 명시한다.
grant all on table public.raw_snapshots to service_role;
grant all on table public.daily_changes to service_role;
grant all on table public.brand_entries to service_role;

commit;

-- ============================================================================
-- 적용하지 않은 것 (의도적)
-- ----------------------------------------------------------------------------
-- · ALTER TABLE ... FORCE ROW LEVEL SECURITY
--     테이블 소유자(postgres)에게까지 RLS 를 적용한다. Supabase Dashboard 의
--     Table Editor 조회가 막힐 수 있어 넣지 않았다. service_role 차단과는 무관.
--
-- · REVOKE USAGE ON SCHEMA public FROM anon, authenticated
--     영향 범위가 스키마 전체라 이 작업의 범위를 넘는다. 필요하면 별도 판단.
--
-- · ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM anon, authenticated
--     앞으로 만들 테이블에도 같은 정책을 적용하고 싶다면 아래를 별도 migration 으로.
--     지금 넣으면 이 프로젝트 밖의 향후 작업까지 조용히 바꾸므로 제외했다.
--       alter default privileges in schema public
--         revoke all on tables    from anon, authenticated;
--       alter default privileges in schema public
--         revoke all on sequences from anon, authenticated;
-- ============================================================================
