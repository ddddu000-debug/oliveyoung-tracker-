# 멀티 플랫폼 랭킹 트래커 (`multi/`)

무신사 뷰티 랭킹 · 올리브영 글로벌(Top Orders)을 매일 TOP100까지 수집하고, 국내 올리브영은
기존 트래커가 쌓는 `raw_snapshots`를 복사해서 한 테이블(`rk_snapshots`)에 함께 누적한다.
일간 변동 · 주간 트래킹 · 월간 베스트는 SQL 뷰로 조회한다.

**기존 트래커와 분리**: 이 폴더와 `multi-*.yml` 워크플로우만 사용하고, `rk_` 로 시작하는 새 테이블에만 쓴다.
기존 `src/`, 기존 워크플로우, 기존 테이블(`raw_snapshots` 등)은 변경하지 않는다(`raw_snapshots`는 읽기만).

| 플랫폼 | 카테고리 | 통화 | 방식 |
| --- | --- | --- | --- |
| `musinsa` 무신사 뷰티 랭킹 | skincare, mask, cleanser | KRW | 랭킹 페이지 수집 |
| `oy_global` 올리브영 글로벌 Top Orders | skincare, body, mask | USD | 베스트셀러 페이지 수집 |
| `oy_kr` 국내 올리브영 | skincare, body, hair, makeup, mask, cleanser | KRW | 기존 `raw_snapshots` 복사 (2026-07-01~) |
| `amazon_us` | — | — | 보류 |

## 설치 순서

1. Supabase SQL Editor에서 `supabase/migrations/20261030000000_multi_platform_init.sql` 실행
   (신규 `rk_` 테이블/뷰 생성 + RLS. 기존 테이블 변경 없음)
2. Secrets는 기존 `SUPABASE_URL`, `SUPABASE_KEY`를 그대로 사용 (추가 설정 없음)
3. Actions → **[멀티] 국내 올리브영 과거 데이터 복사** 1회 실행 (기본 2026-07-01부터)
4. Actions → **[멀티] 무신사·올영 글로벌 랭킹 일일 수집** 수동 실행으로 확인 → 이후 매일 KST 10:30 자동 실행

## 테이블 / 뷰

| 이름 | 내용 |
| --- | --- |
| `rk_snapshots` | 날짜 × 플랫폼 × 카테고리 × 순위 원본 (가격, 평점, 리뷰 수, 배지, 원문 JSON) |
| `rk_products` | 플랫폼 고유 ID 기준 상품 마스터, first_seen / last_seen |
| `rk_scrape_runs` | 플랫폼·카테고리별 수집 성공/실패 로그 |
| `rk_v_daily_changes` | 직전 수집일 대비 순위·가격 변동, 첫 진입·재진입 |
| `rk_v_weekly_product` | 주(월~일)별 TOP100/TOP10 체류 일수, 최고·평균 순위, 점수 |
| `rk_v_monthly_best` | 월별 점수(Σ(101−순위)) 순위 = 월간 베스트 |
| `rk_v_brand_daily` | 날짜별 브랜드 TOP100 진입 상품 수 |

### 예시 쿼리

```sql
-- 이번 달 무신사 스킨케어 월간 베스트 10
select month_rank, brand_name, product_name, days_in_top100, best_rank, avg_rank
from rk_v_monthly_best
where platform = 'musinsa' and category = 'skincare' and month = date_trunc('month', now())::date
order by month_rank limit 10;

-- 오늘 올리브영 글로벌 마스크 급상승
select rank, prev_rank, rank_change, brand_name, product_name
from rk_v_daily_changes
where platform = 'oy_global' and category = 'mask' and snapshot_date = (now() at time zone 'Asia/Seoul')::date
order by rank_change desc nulls last limit 10;
```

## 로컬 실행

```bash
cd multi && npm ci && npx playwright install chromium
node src/discover.js musinsa                          # 구조 확인 (DB 저장 없음)
node src/runner.js --platform=musinsa --category=skincare
```
