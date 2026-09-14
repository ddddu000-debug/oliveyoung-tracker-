-- ============================================================================
-- 20260910120000_enable_rls_lockdown_rollback.sql
--
-- 위 migration 을 되돌린다 — Supabase 기본 상태(= 취약한 상태)로 복구.
-- ⚠️ 이 스크립트를 실행하면 Security Advisor 의 Critical 오류가 다시 나타난다.
--    수집 파이프라인이 깨져 긴급 복구가 필요할 때만 사용할 것.
--
-- ⚠️ supabase/migrations 가 아니라 supabase/rollback 에 둔다.
--    Supabase CLI 는 migrations 디렉터리만 적용하므로 실수로 실행되지 않는다.
-- ============================================================================

begin;

-- 1. GRANT 복구 (Supabase 신규 테이블 기본값)
grant all on table public.raw_snapshots to anon, authenticated;
grant all on table public.daily_changes to anon, authenticated;
grant all on table public.brand_entries to anon, authenticated;

-- 2. 시퀀스 GRANT 복구
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
    execute format('grant usage, select on sequence %s to anon, authenticated', seq_name);
  end loop;
end
$$;

-- 3. RLS 비활성화
alter table public.raw_snapshots disable row level security;
alter table public.daily_changes disable row level security;
alter table public.brand_entries disable row level security;

commit;
