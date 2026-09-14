-- =============================================================
-- STEP 3 : RLS Lockdown 적용 후 검증 (READ ONLY)
-- 결과표 1개로 모든 검사를 반환한다.
-- Supabase SQL Editor 는 여러 문장 실행 시 마지막 결과만 보여주므로 단일 쿼리로 합쳤다.
--
-- 기대 결과 : 28행
--   - 9_ROW_COUNT 3행 = '수동확인'
--   - 나머지 25행 = 'PASS'
-- =============================================================

with tbls(tbl) as (
  values ('raw_snapshots'), ('daily_changes'), ('brand_entries')
),
rls as (
  select '1_RLS_ENABLED'::text as check_name,
         c.relname::text       as subject,
         c.relrowsecurity::text as result,
         'true'::text          as expected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('raw_snapshots','daily_changes','brand_entries')
),
pol as (
  select '2_POLICY_COUNT', t.tbl,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.tbl)::text,
         '0'
  from tbls t
),
grt as (
  select '3_GRANT_anon_auth', t.tbl,
         (select count(*) from information_schema.role_table_grants g
           where g.table_schema = 'public' and g.table_name = t.tbl
             and g.grantee in ('anon','authenticated'))::text,
         '0'
  from tbls t
),
svc as (
  select '4_GRANT_service_role', t.tbl,
         (select count(*) from information_schema.role_table_grants g
           where g.table_schema = 'public' and g.table_name = t.tbl
             and g.grantee = 'service_role')::text,
         '>0'
  from tbls t
),
anonpriv as (
  select '5_ANON_PRIV_SIUD', t.tbl,
         concat_ws('/',
           has_table_privilege('anon', 'public.' || t.tbl, 'SELECT')::text,
           has_table_privilege('anon', 'public.' || t.tbl, 'INSERT')::text,
           has_table_privilege('anon', 'public.' || t.tbl, 'UPDATE')::text,
           has_table_privilege('anon', 'public.' || t.tbl, 'DELETE')::text),
         'false/false/false/false'
  from tbls t
),
authpriv as (
  select '6_AUTHED_PRIV_SIUD', t.tbl,
         concat_ws('/',
           has_table_privilege('authenticated', 'public.' || t.tbl, 'SELECT')::text,
           has_table_privilege('authenticated', 'public.' || t.tbl, 'INSERT')::text,
           has_table_privilege('authenticated', 'public.' || t.tbl, 'UPDATE')::text,
           has_table_privilege('authenticated', 'public.' || t.tbl, 'DELETE')::text),
         'false/false/false/false'
  from tbls t
),
svcpriv as (
  select '7_SVC_PRIV_SIUD', t.tbl,
         concat_ws('/',
           has_table_privilege('service_role', 'public.' || t.tbl, 'SELECT')::text,
           has_table_privilege('service_role', 'public.' || t.tbl, 'INSERT')::text,
           has_table_privilege('service_role', 'public.' || t.tbl, 'UPDATE')::text,
           has_table_privilege('service_role', 'public.' || t.tbl, 'DELETE')::text),
         'true/true/true/true'
  from tbls t
),
seqs as (
  select distinct
         '8_SEQ_GRANT_anon_auth',
         s.relname::text,
         (select count(*) from aclexplode(coalesce(s.relacl, acldefault('S', s.relowner))) a
           where a.grantee::regrole::text in ('anon','authenticated'))::text,
         '0'
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
),
cnts as (
  select '9_ROW_COUNT', 'raw_snapshots', (select count(*) from public.raw_snapshots)::text, 'STEP1과 동일'
  union all
  select '9_ROW_COUNT', 'daily_changes', (select count(*) from public.daily_changes)::text, 'STEP1과 동일'
  union all
  select '9_ROW_COUNT', 'brand_entries', (select count(*) from public.brand_entries)::text, 'STEP1과 동일'
),
bypass as (
  select '0_SVC_BYPASSRLS'::text as check_name,
         'service_role'::text    as subject,
         coalesce((select rolbypassrls from pg_roles where rolname='service_role')::text, 'ROLE_NOT_FOUND') as result,
         'true'::text            as expected
),
all_checks as (
  select * from bypass
  union all select * from rls
  union all select * from pol
  union all select * from grt
  union all select * from svc
  union all select * from anonpriv
  union all select * from authpriv
  union all select * from svcpriv
  union all select * from seqs
  union all select * from cnts
)
select check_name,
       subject,
       result,
       expected,
       case
         when expected = 'STEP1과 동일' then '수동확인'
         when expected = '>0'           then case when result::int > 0 then 'PASS' else 'FAIL' end
         when result = expected         then 'PASS'
         else 'FAIL'
       end as verdict
from all_checks
order by check_name, subject;
