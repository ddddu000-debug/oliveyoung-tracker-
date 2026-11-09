-- ============================================================================
-- 멀티 플랫폼 랭킹 트래커 — 신규 테이블/뷰
-- 기존 트래커 테이블(raw_snapshots / daily_changes / brand_entries)은 건드리지 않는다.
-- 모든 신규 객체는 rk_ 접두사로 구분.
-- ============================================================================

begin;

-- 상품 마스터: 플랫폼 고유 ID 기준 (이름이 바뀌어도 같은 상품)
create table if not exists public.rk_products (
  platform      text        not null,   -- oy_kr | oy_global | musinsa | amazon_us
  product_id    text        not null,   -- goodsNo / 무신사 상품번호 / ASIN
  brand_name    text,
  brand_key     text,                   -- 공백 제거 + 소문자
  product_name  text,
  product_url   text,
  image_url     text,
  first_seen    date        not null,
  last_seen     date        not null,
  updated_at    timestamptz not null default now(),
  primary key (platform, product_id)
);

-- 매일 TOP N 원본
create table if not exists public.rk_snapshots (
  snapshot_date   date        not null,   -- KST 기준 날짜
  platform        text        not null,
  category        text        not null,   -- 통합 카테고리: skincare | mask | cleanser | body | ...
  rank            int         not null,
  product_id      text        not null,
  brand_name      text,
  product_name    text,
  currency        text,                   -- KRW | USD
  list_price      numeric,
  sale_price      numeric,
  discount_rate   numeric,                -- 0.25 = 25%
  rating          numeric,
  review_count    int,
  badges          jsonb       not null default '[]'::jsonb,
  raw             jsonb,
  run_id          text,
  collected_at    timestamptz not null default now(),
  primary key (snapshot_date, platform, category, rank)
);
create index if not exists rk_snapshots_product_idx on public.rk_snapshots (platform, product_id, snapshot_date);

-- 수집 실행 로그: 어느 플랫폼/카테고리가 언제 빠졌는지
create table if not exists public.rk_scrape_runs (
  run_id        text        not null,
  platform      text        not null,
  category      text        not null,
  snapshot_date date        not null,
  status        text        not null,   -- success | partial | failed
  item_count    int         not null default 0,
  error         text,
  started_at    timestamptz not null,
  finished_at   timestamptz not null default now(),
  primary key (run_id, platform, category)
);

-- ── 뷰 ─────────────────────────────────────────────────────────────────────

-- 일간 변동: 직전 수집일 대비 순위·가격
create or replace view public.rk_v_daily_changes as
with s as (
  select s.*,
         lag(snapshot_date) over w as prev_seen_date,
         lag(rank)          over w as prev_rank,
         lag(sale_price)    over w as prev_sale_price
  from public.rk_snapshots s
  window w as (partition by platform, category, product_id order by snapshot_date)
),
prev_day as (
  select platform, category, snapshot_date,
         lag(snapshot_date) over (partition by platform, category order by snapshot_date) as prev_date
  from (select distinct platform, category, snapshot_date from public.rk_snapshots) d
)
select s.snapshot_date, s.platform, s.category, s.rank, s.product_id, s.brand_name, s.product_name,
       s.sale_price, s.currency,
       case when s.prev_seen_date = p.prev_date then s.prev_rank end                 as prev_rank,
       case when s.prev_seen_date = p.prev_date then s.prev_rank - s.rank end        as rank_change,
       case when s.prev_seen_date = p.prev_date then s.sale_price - s.prev_sale_price end as price_change,
       (s.prev_seen_date is null)                                                    as is_first_entry,
       (s.prev_seen_date is not null and s.prev_seen_date <> p.prev_date)            as is_reentry
from s join prev_day p using (platform, category, snapshot_date);

-- 주간 트래킹 (월~일, ISO 주)
create or replace view public.rk_v_weekly_product as
select date_trunc('week', snapshot_date)::date as week_start,
       platform, category, product_id,
       max(brand_name)   as brand_name,
       max(product_name) as product_name,
       count(*)                          as days_in_top100,
       count(*) filter (where rank <= 10) as days_in_top10,
       min(rank)                         as best_rank,
       round(avg(rank), 1)               as avg_rank,
       sum(101 - rank)                   as score
from public.rk_snapshots
group by 1, 2, 3, 4;

-- 월간 베스트: 점수 = Σ(101 − 순위)
create or replace view public.rk_v_monthly_best as
select *, rank() over (partition by month, platform, category order by score desc) as month_rank
from (
  select date_trunc('month', snapshot_date)::date as month,
         platform, category, product_id,
         max(brand_name)   as brand_name,
         max(product_name) as product_name,
         count(*)                          as days_in_top100,
         count(*) filter (where rank <= 10) as days_in_top10,
         min(rank)                         as best_rank,
         round(avg(rank), 1)               as avg_rank,
         sum(101 - rank)                   as score
  from public.rk_snapshots
  group by 1, 2, 3, 4
) m;

-- 브랜드 점유: 날짜별 TOP100 내 상품 수
create or replace view public.rk_v_brand_daily as
select snapshot_date, platform, category,
       lower(regexp_replace(coalesce(brand_name, ''), '\s+', '', 'g')) as brand_key,
       max(brand_name) as brand_name,
       count(*)        as products_in_top100,
       min(rank)       as best_rank
from public.rk_snapshots
group by 1, 2, 3, 4;

-- ── 보안: 기존 테이블과 동일하게 서버 전용(service_role) 접근 ─────────────
alter table public.rk_products    enable row level security;
alter table public.rk_snapshots   enable row level security;
alter table public.rk_scrape_runs enable row level security;

revoke all on public.rk_products, public.rk_snapshots, public.rk_scrape_runs from anon, authenticated;
revoke all on public.rk_v_daily_changes, public.rk_v_weekly_product, public.rk_v_monthly_best, public.rk_v_brand_daily from anon, authenticated;

-- 뷰가 호출자 권한으로 RLS 를 따르도록 (Supabase Security Advisor 대응)
alter view public.rk_v_daily_changes  set (security_invoker = on);
alter view public.rk_v_weekly_product set (security_invoker = on);
alter view public.rk_v_monthly_best   set (security_invoker = on);
alter view public.rk_v_brand_daily    set (security_invoker = on);

commit;
