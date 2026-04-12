const { getSheets, readSheet, overwriteSheet } = require('./sheets');
require('dotenv').config();

async function updateDashboard(todayProducts, dailyChanges) {
  console.log('\n[Sheets] dashboard 갱신 중...');
  const sheets = await getSheets();
  const today  = todayProducts[0]?.snapshot_date;
  const now    = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const rows = [];

  // ── 헤더 ──────────────────────────────────────────────────────────
  rows.push(['📊 올리브영 스킨케어 랭킹 대시보드']);
  rows.push([`기준일: ${today}`, `마지막 수집: ${now}`]);
  rows.push([]);

  // ── 오늘 TOP 10 ───────────────────────────────────────────────────
  rows.push(['🏆 오늘 TOP 10']);
  rows.push(['순위', '브랜드', '상품명', '판매가', '할인율', '배지']);
  todayProducts.slice(0, 10).forEach(p => {
    const discountPct = p.price_discount_rate
      ? `${Math.round(p.price_discount_rate * 100)}%`
      : '-';
    rows.push([
      p.rank,
      p.brand_name_raw,
      p.product_name_raw.slice(0, 35),
      p.sale_price ? `${p.sale_price.toLocaleString()}원` : '-',
      discountPct,
      p.badges || '',
    ]);
  });
  rows.push([]);

  // ── 순위 급상승 TOP 5 ─────────────────────────────────────────────
  const risers = dailyChanges
    .filter(c => c.rank_change !== '' && c.rank_change > 0)
    .sort((a, b) => b.rank_change - a.rank_change)
    .slice(0, 5);

  rows.push(['📈 전일 대비 순위 급상승 TOP 5']);
  if (risers.length === 0) {
    rows.push(['(전일 데이터 없음 — 내일부터 표시됩니다)']);
  } else {
    rows.push(['브랜드', '오늘 순위', '전일 순위', '변동']);
    risers.forEach(c => {
      rows.push([c.brand_key, c.today_rank, c.yesterday_rank, `▲ ${c.rank_change}`]);
    });
  }
  rows.push([]);

  // ── 가격 변동 ─────────────────────────────────────────────────────
  const priceChanged = dailyChanges.filter(c => c.is_price_changed);

  rows.push(['💰 가격 변동 상품']);
  if (priceChanged.length === 0) {
    rows.push(['(가격 변동 없음)']);
  } else {
    rows.push(['브랜드', '오늘 가격', '전일 가격', '변동액', '변동률']);
    priceChanged.forEach(c => {
      const sign = c.price_change > 0 ? '+' : '';
      const rate = c.price_change_rate
        ? `${sign}${Math.round(c.price_change_rate * 100)}%`
        : '-';
      rows.push([
        c.brand_key,
        `${c.today_sale_price.toLocaleString()}원`,
        `${c.yesterday_sale_price.toLocaleString()}원`,
        `${sign}${c.price_change.toLocaleString()}원`,
        rate,
      ]);
    });
  }
  rows.push([]);

  // ── 신규 진입 브랜드 ──────────────────────────────────────────────
  const newBrands = dailyChanges.filter(c => c.is_new_entry);

  rows.push(['🆕 오늘 신규 진입']);
  if (newBrands.length === 0) {
    rows.push(['(신규 진입 없음)']);
  } else {
    rows.push(['브랜드', '진입 순위', '재진입여부']);
    newBrands.forEach(c => {
      rows.push([c.brand_key, c.today_rank, c.is_reentry ? '재진입' : '첫등장']);
    });
  }
  rows.push([]);

  // ── 최근 7일 브랜드 등장 횟수 ────────────────────────────────────
  const brandEntrySheet = await readSheet(sheets, 'brand_entries');
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  const brandCount = {};
  brandEntrySheet.slice(1)
    .filter(row => row[0] >= sevenDaysAgoStr)
    .forEach(row => {
      const brand = row[2] || row[1]; // brand_name_raw 또는 brand_key
      brandCount[brand] = (brandCount[brand] || 0) + 1;
    });

  const brandRanking = Object.entries(brandCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  rows.push(['📅 최근 7일 자주 등장한 브랜드']);
  if (brandRanking.length === 0) {
    rows.push(['(데이터 쌓이는 중 — 7일 후부터 표시됩니다)']);
  } else {
    rows.push(['브랜드', '등장 횟수']);
    brandRanking.forEach(([brand, cnt]) => rows.push([brand, cnt]));
  }

  await overwriteSheet(sheets, 'dashboard', rows);
  console.log('  ✅ dashboard 갱신 완료');
}

module.exports = { updateDashboard };
