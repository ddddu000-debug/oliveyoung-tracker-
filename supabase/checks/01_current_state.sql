-- ============================================================================
-- 01_current_state.sql  —  변경 전 현재 권한 상태 스냅샷 (READ ONLY)
-- 실행: Supabase Dashboard → SQL Editor 에 붙여넣고 실행
-- 목적: RLS 활성화 여부 / Policy / GRANT / schema privilege / bypassrls 확인
-- 이 파일은 조회만 합니다. 어떤 것도 변경하지 않습니다.
-- ============================================================================

-- [1] RLS 활성화 여부 -----------------------------------------------------
select c.relname            as table_name,
       c.relrowsecurity     as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('raw_snapshots','daily_changes','brand_entries')
order by 1;

-- [2] 기존 Policy 존재 여부 ------------------------------------------------
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('raw_snapshots','daily_changes','brand_entries')
order by tablename, policyname;

-- [3] 테이블 GRANT (anon / authenticated / service_role / PUBLIC) ----------
select table_name,
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('raw_snapshots','daily_changes','brand_entries')
group by table_name, grantee
order by table_name, grantee;

-- [4] 시퀀스 GRANT (INSERT 시 필요) ---------------------------------------
--     aclexplode 는 집합반환함수이므로 lateral 로 조인한다 (select 목록에 직접 두면
--     동일 SRF 가 두 번 평가되는 형태가 되어 버전에 따라 결과가 흔들릴 수 있음).
select s.relname               as sequence_name,
       t.relname               as owner_table,
       a.grantee::regrole::text as grantee,
       a.privilege_type
from pg_class s
join pg_namespace ns on ns.oid = s.relnamespace
join pg_depend d  on d.objid = s.oid
                 and d.classid = 'pg_class'::regclass
                 and d.deptype in ('a','i')
join pg_class t   on t.oid = d.refobjid
join pg_namespace tn on tn.oid = t.relnamespace
cross join lateral aclexplode(coalesce(s.relacl, acldefault('S', s.relowner))) a
where s.relkind = 'S'
  and tn.nspname = 'public'
  and t.relname in ('raw_snapshots','daily_changes','brand_entries')
order by 1, 3, 4;

-- [5] schema public 접근 권한 ---------------------------------------------
select r.rolname as role,
       has_schema_privilege(r.rolname, 'public', 'USAGE')  as usage,
       has_schema_privilege(r.rolname, 'public', 'CREATE') as create_
from pg_roles r
where r.rolname in ('anon','authenticated','service_role')
order by 1;

-- [6] service_role 의 RLS 우회 속성 ---------------------------------------
--     rolbypassrls = true 여야 RLS 를 켜도 서버 파이프라인이 그대로 동작합니다.
select rolname, rolbypassrls, rolsuper, rolcanlogin
from pg_roles
where rolname in ('anon','authenticated','service_role','postgres','authenticator')
order by 1;

-- [7] public 스키마 전체 테이블의 RLS 현황 (누락 테이블 확인용) -------------
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 2, 1;

-- [8] DEFAULT PRIVILEGES (향후 생성 테이블에 자동 부여되는 권한) ------------
select defaclrole::regrole    as grantor,
       defaclnamespace::regnamespace as schema,
       defaclobjtype          as obj_type,
       defaclacl              as default_acl
from pg_default_acl;
