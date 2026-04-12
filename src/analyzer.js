const { makeProductKey, normalizeBrand } = require('./normalizer');

// raw_snapshots 헤더 순서 (sheets.js와 동일)
const HEADERS = [
  'snapshot_date', 'collected_at', 'run_id', 'category',
  'rank', 'product_name_raw', 'brand_name_raw',
  'list_price', 'sale_price', 'price_discount_amount', 'price_discount_rate',
  'product_url', 'badges', 'is_sold_out', 'source_url',
];

// 시트 행(배열) → 객체로 변환
function rowToObj(row) {
  const obj = {};
  HEADERS.forEach((key, i) => { obj[key] = row[i] ?? ''; });
  obj.rank       = parseInt(obj.rank) || 0;
  obj.sale_price = parseInt(obj.sale_price) || null;
  obj.list_price = parseInt(obj.list_price) || null;
  return obj;
}

// raw_snapshots 전체 데이터에서 특정 날짜 데이터만 추출
function filterByDate(allRows, date) {
  return allRows
    .slice(1)                          // 헤더 제거
    .filter(row => row[0] === date)    // snapshot_date 일치
    .map(rowToObj);
}

// 과거에 등장한 브랜드 목록 수집 (특정 날짜 이전)
function getBrandsBeforeDate(allRows, date) {
  const brands = new Set();
  allRows.slice(1)
    .filter(row => row[0] < date)      // 해당 날짜 이전 데이터
    .forEach(row => {
      if (row[6]) brands.add(normalizeBrand(row[6]));
    });
  return brands;
}

// ── 메인 분석 함수 ─────────────────────────────────────────────────────
function analyze(allRows, todayProducts) {
  const today     = todayProducts[0]?.snapshot_date;
  const yesterday = getPreviousDate(today, allRows);

  const yesterdayData = yesterday ? filterByDate(allRows, yesterday) : [];
  const pastBrands    = getBrandsBeforeDate(allRows, today);

  // 전일 데이터를 product_key로 빠르게 찾을 수 있게 Map 생성
  const yesterdayMap = new Map();
  yesterdayData.forEach(p => {
    const key = makeProductKey(p.brand_name_raw, p.product_name_raw);
    yesterdayMap.set(key, p);
  });

  const dailyChanges = [];
  const brandEntries = [];

  todayProducts.forEach(p => {
    const key       = makeProductKey(p.brand_name_raw, p.product_name_raw);
    const brandKey  = normalizeBrand(p.brand_name_raw);
    const prev      = yesterdayMap.get(key);

    // 순위 변동
    const todayRank     = p.rank;
    const yesterdayRank = prev ? prev.rank : null;
    const rankChange    = prev ? (yesterdayRank - todayRank) : null;

    // 가격 변동
    const todayPrice     = p.sale_price;
    const yesterdayPrice = prev ? prev.sale_price : null;
    const priceChange    = (todayPrice && yesterdayPrice) ? todayPrice - yesterdayPrice : null;
    const priceChangeRate = (priceChange && yesterdayPrice)
      ? Math.round((priceChange / yesterdayPrice) * 1000) / 1000
      : null;

    // 신규/재진입 여부
    const isNewEntry  = !prev;
    const isReentry   = !prev && pastBrands.has(brandKey);
    const isPriceChanged = priceChange !== null && priceChange !== 0;

    dailyChanges.push({
      snapshot_date:        today,
      product_key:          key,
      brand_key:            brandKey,
      today_rank:           todayRank,
      yesterday_rank:       yesterdayRank ?? '',
      rank_change:          rankChange ?? '',
      today_sale_price:     todayPrice ?? '',
      yesterday_sale_price: yesterdayPrice ?? '',
      price_change:         priceChange ?? '',
      price_change_rate:    priceChangeRate ?? '',
      is_new_entry:         isNewEntry,
      is_reentry:           isReentry,
      is_price_changed:     isPriceChanged,
    });

    // 브랜드 신규/재진입 기록
    if (isNewEntry) {
      brandEntries.push({
        snapshot_date:  today,
        brand_key:      brandKey,
        brand_name_raw: p.brand_name_raw,
        is_new_entry:   !pastBrands.has(brandKey),  // 역대 첫 등장
        is_reentry:     isReentry,
        entry_rank:     todayRank,
      });
    }
  });

  return { dailyChanges, brandEntries };
}

// raw_snapshots에서 오늘 바로 전날 데이터가 있는 날짜 찾기
function getPreviousDate(today, allRows) {
  const dates = [...new Set(
    allRows.slice(1)
      .map(row => row[0])
      .filter(d => d && d < today)
  )].sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

module.exports = { analyze };
