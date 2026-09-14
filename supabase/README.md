# Supabase 보안 — RLS Lockdown

Supabase Security Advisor 의 **`RLS Disabled in Public` (Critical) 3건**을 해소한다.

대상: `public.raw_snapshots` · `public.daily_changes` · `public.brand_entries`

> ## ✅ 상태 — 프로덕션 적용 및 검증 완료 (2026-09-14)
>
> 아래 "적용 이력" 절에 실측 결과가 있다. **migration 을 다시 실행할 필요 없다.**

---

## 적용 이력

### 2026-09-14 — 프로덕션 적용 완료

| 단계 | 결과 |
|---|---|
| 전제조건: `SUPABASE_KEY` → `service_role` 교체 | ✅ 완료 |
| STEP 2 — `migrations/20260910120000_enable_rls_lockdown.sql` | ✅ **Success** |
| STEP 3 — `checks/02_post_verify.sql` | ✅ **FAIL 0건** |
| STEP 4 — Actions `Supabase Keepalive` 수동 실행 | ✅ **Success** |
| STEP 5 — Actions `올리브영 랭킹 일일 수집` 수동 실행 | ✅ **Success** |
| STEP 6 — Security Advisor Rerun linter | ✅ **Errors 0 / Warnings 0 / No errors detected** |

검증 쿼리 실측:

| check | 결과 |
|---|---|
| `1_RLS_ENABLED` | 3개 테이블 모두 `true` |
| `2_POLICY_COUNT` | 3개 테이블 모두 `0` — 전체 허용 정책 없음 |
| `3_GRANT_anon_auth` | anon / authenticated 권한 차단 확인 |
| `5_ANON_PRIV_SIUD` · `6_AUTHED_PRIV_SIUD` | SELECT/INSERT/UPDATE/DELETE 전부 불가 |
| `0_SVC_BYPASSRLS` · `4_GRANT_service_role` · `7_SVC_PRIV_SIUD` | service_role 권한 및 BYPASSRLS 정상 |

**Security Advisor 결과**

| 테이블 | 적용 전 | 적용 후 |
|---|---|---|
| `public.raw_snapshots` | ❌ RLS Disabled in Public | ✅ 해소 |
| `public.daily_changes` | ❌ RLS Disabled in Public | ✅ 해소 |
| `public.brand_entries` | ❌ RLS Disabled in Public | ✅ 해소 |

파이프라인 영향 없음 — Keepalive(읽기 경로)와 일일 수집(수집·DELETE·INSERT·리포트 전 경로)
모두 실측 성공. 데이터 손실 없음(migration 은 DML 0건).

---

## 왜 이 구조인가

이 프로젝트의 DB 접근은 **100% 서버 사이드**다. GitHub Actions 안의 Node.js 프로세스가
전부이며, 브라우저에서 Supabase 를 호출하는 코드는 한 줄도 없다.
GitHub Pages 산출물(`gh-pages` 브랜치)은 `src/report.js` 가 **빌드 타임에 데이터를 구워 넣은
정적 HTML** 이라 Supabase SDK 도 키도 들어가지 않는다.

| 워크플로우 | 실행 | 진입점 |
|---|---|---|
| `daily-scrape.yml` | 매일 UTC 00:00 | `src/runner.js` |
| `keepalive.yml` | 주 2회 (월·목) | `src/keepalive.js` |
| `reset-and-seed.yml` | 수동 (`RESET` 입력) | `src/reset.js` → `src/runner.js` |

따라서 `anon` / `authenticated` 에게 필요한 권한이 **하나도 없다.**

- **RLS ON + Policy 0개** = 두 역할 전면 거부
- **GRANT 회수** = 정책 이전에 테이블 권한 자체가 없음 (2중 방어)
- `service_role` 은 `rolbypassrls` 로 RLS 를 우회 → 파이프라인 무영향

`using (true)` 같은 전면 허용 정책은 RLS 를 켜는 의미를 없애므로 **만들지 않는다.**

---

## 전제조건

GitHub Secrets 의 `SUPABASE_KEY` 가 **`service_role` 키**여야 한다.
`anon` 키인 상태로 적용하면 수집·저장·리포트·keepalive 가 전부 실패한다.

migration 0번 블록의 **SAFETY GUARD** 가 이것을 검사한다 —
`service_role` 에 `BYPASSRLS` 가 없으면 `raise exception` 으로 트랜잭션 전체를 롤백하므로,
**파이프라인이 깨지는 시나리오에서는 RLS 가 애초에 켜지지 않는다.**

---

## 파일 구성

| 파일 | 역할 |
|---|---|
| `migrations/20260910120000_enable_rls_lockdown.sql` | **본 변경.** 그대로 SQL Editor 에 붙여넣는다 |
| `checks/01_current_state.sql` | 적용 **전** 상태 조회 8종 (읽기 전용) |
| `checks/02_post_verify.sql` | 적용 **후** 검증. 결과표 1개로 반환 |
| `rollback/20260910120000_enable_rls_lockdown_rollback.sql` | 되돌리기 |
| `../scripts/rehearse-rls-migration.js` | 인메모리 Postgres 리허설 (`npm run rehearse:rls`) |
| `../scripts/verify-rls.js` | REST 실측 검증 (`npm run verify:rls`) |

SQL 은 **각 파일에 하나씩만** 존재한다. 같은 SQL 을 두 곳에 두면 반드시 어긋나므로
붙여넣기용 사본을 따로 만들지 않는다.

---

## 적용 절차

> 현재 프로덕션에는 **이미 적용 완료**됐다(위 "적용 이력" 참조).
> 아래는 새 환경에 재현하거나 롤백 후 재적용할 때의 절차다.

| # | 작업 | 방법 |
|---|---|---|
| 1 | 로컬 리허설 | `npm i -D @electric-sql/pglite` → `npm run rehearse:rls` |
| 2 | 적용 전 상태 기록 | `checks/01_current_state.sql` → SQL Editor |
| 3 | migration 적용 | `migrations/20260910120000_...sql` → SQL Editor |
| 4 | 적용 후 검증 | `checks/02_post_verify.sql` → SQL Editor |
| 5 | keepalive 실측 | Actions → `Supabase Keepalive` 수동 실행 |
| 6 | 전체 파이프라인 실측 | Actions → `올리브영 랭킹 일일 수집` 수동 실행 |
| 7 | Advisor 확인 | Supabase → Advisors → Security → Rerun linter |

⚠️ 6번은 **당일 데이터를 재수집·덮어쓰기** 한다. `src/database.js` 가 날짜·카테고리 단위로
기존 행을 지우고 다시 넣는 멱등 설계라 안전하다.

문제 발생 시 `rollback/` 실행 — 되돌리면 Advisor 오류도 함께 되살아난다.

---

## 검증 기준

`checks/02_post_verify.sql` 는 28행을 반환한다.
**`9_ROW_COUNT` 3행만 `수동확인`(적용 전 행 수와 대조), 나머지 25행은 전부 `PASS`** 여야 한다.

| check | 기대값 | 의미 |
|---|---|---|
| `0_SVC_BYPASSRLS` | `true` | service_role 이 RLS 를 우회할 수 있음 |
| `1_RLS_ENABLED` | `true` × 3 | Advisor 오류의 직접 해소 조건 |
| `2_POLICY_COUNT` | `0` × 3 | 전체 허용 정책이 만들어지지 않음 |
| `3_GRANT_anon_auth` | `0` × 3 | anon/authenticated 테이블 권한 없음 |
| `4_GRANT_service_role` | `>0` × 3 | 파이프라인 권한 유지 |
| `5_ANON_PRIV_SIUD` | `false/false/false/false` × 3 | anon SELECT/INSERT/UPDATE/DELETE 전부 불가 |
| `6_AUTHED_PRIV_SIUD` | `false/false/false/false` × 3 | authenticated 동일 |
| `7_SVC_PRIV_SIUD` | `true/true/true/true` × 3 | service_role 전부 가능 |
| `8_SEQ_GRANT_anon_auth` | `0` | 시퀀스 권한도 회수됨 |

---

## 리허설 (`npm run rehearse:rls`)

일회용 **인메모리** PGlite 인스턴스에 Supabase 초기 조건을 재현하고 migration 을 실제로
실행한다. 실제 Supabase 에 접속하지 않고 파일도 쓰지 않는다.

검증 항목:

1. 변경 **전** anon 이 실제로 뚫려 있는지 (이 migration 이 필요한 이유)
2. migration 실행 — 문법 · DO 블록 · SAFETY GUARD
3. 변경 **후** anon / authenticated 가 3테이블 × SIUD 전부 차단되는지
4. `service_role` 로 실제 파이프라인 호출 패턴 12종이 그대로 동작하는지
   (`keepalive` count / 3테이블 DELETE+INSERT / 어제 날짜 조회 / 과거 브랜드 조회 /
   `report.js` 전체 조회 2종 / `reset.js` 전량 삭제 패턴)
5. `checks/02_post_verify.sql` 이 전부 PASS 를 내는지
6. rollback 스크립트가 정상 동작하는지

전부 통과하면 종료코드 0.

> 리허설의 테이블 스키마는 `src/database.js` 가 INSERT 하는 컬럼 기준으로 재현한 것이며
> 프로덕션 스키마와 1:1 이 아니다. 검증 대상은 데이터가 아니라 **권한**이다.

---

## REST 실측 (`npm run verify:rls`)

PostgREST 경로로 anon 차단과 service_role 정상을 확인한다. 선택 사항이며,
`checks/02_post_verify.sql` 의 `has_table_privilege` 검사만으로도 차단은 증명된다.

```powershell
$env:SUPABASE_URL="https://xxxx.supabase.co"
$env:SUPABASE_ANON_KEY="<anon key>"
$env:SUPABASE_SERVICE_KEY="<service_role key>"   # 선택
npm run verify:rls
```

INSERT 테스트는 **고의로 잘못된 날짜값**을 보낸다. Postgres 는 권한을 타입보다 먼저
검사하므로 `42501` 이면 차단 확인, 그 외 오류면 권한이 열려 있다는 뜻이며
**어느 쪽이든 행이 써지지 않는다.** UPDATE/DELETE 는 매칭 0건 필터를 쓴다.

---

## Supabase CLI 로 적용하려면

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

CLI 는 `supabase/migrations` 만 읽는다. `rollback/` 과 `checks/` 는 자동 실행되지 않는다.

---

## 적용하지 않은 것 (의도적)

- **`FORCE ROW LEVEL SECURITY`** — 테이블 소유자(`postgres`)에게까지 RLS 를 적용해
  Dashboard Table Editor 조회가 막힐 수 있다. `service_role` 차단과는 무관하다.
- **`REVOKE USAGE ON SCHEMA public`** — 영향 범위가 스키마 전체라 이 작업의 범위를 넘는다.
- **`ALTER DEFAULT PRIVILEGES`** — 앞으로 만들 테이블까지 조용히 바꾼다.
  필요하면 별도 migration 으로 분리할 것.
