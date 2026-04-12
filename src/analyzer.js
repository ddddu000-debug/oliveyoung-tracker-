const { makeProductKey, normalizeBrand } = require('./normalizer');

// ── 메인 분석 함수 ─────────────────────────────────────────────────────
// yesterdayProducts: Supabase에서 가져온 어제 데이터 (객체 배열)
// todayProducts: 오늘 수집한 데이터 (객체 배열)
// pastBrandKeys: 과거에 등장했던 브랜드 key Set
function analyze(yesterdayProducts, todayProducts, pastBrandKeys = new Set()) {
  const today = todayProducts[0]?.snapshot_date;

  // 전일 데이터를 product_key로 빠르게 찾을 수 있게 Map 생성
  const yesterdayMap = new Map();
  yesterdayProducts.forEach(p => {
    const key = makeProductKey(p.brand_name_raw, p.product_name_raw);
    yesterdayMap.set(key, p);
  });

  const dailyChanges = [];
  const brandEntries = [];

  todayProducts.forEach(p => {
    const key      = makeProductKey(p.brand_name_raw, p.product_name_raw);
    const brandKey = normalizeBrand(p.brand_name_raw);
    const prev     = yesterdayMap.get(key);

    // 순위 변동
    const todayRank     = p.rank;
    const yesterdayRank = prev ? prev.rank : null;
    const rankChange    = prev ? (yesterdayRank - todayRank) : null;

    // 가격 변동
    const todayPrice      = p.sale_price;
    const yesterdayPrice  = prev ? prev.sale_price : null;
    const priceChange     = (todayPrice && yesterdayPrice) ? todayPrice - yesterdayPrice : null;
    const priceChangeRate = (priceChange && yesterdayPrice)
      ? Math.round((priceChange / yesterdayPrice) * 1000) / 1000
      : null;

    // 신규/재진입 여부
    const isNewEntry     = !prev;
    const isReentry      = !prev && pastBrandKeys.has(brandKey);
    const isPriceChanged = priceChange !== null && priceChange !== 0;

    dailyChanges.push({
      snapshot_date:        today,
      product_key:          key,
      brand_key:            brandKey,
      today_rank:           todayRank,
      yesterday_rank:       yesterdayRank ?? null,
      rank_change:          rankChange ?? null,
      today_sale_price:     todayPrice ?? null,
      yesterday_sale_price: yesterdayPrice ?? null,
      price_change:         priceChange ?? null,
      price_change_rate:    priceChangeRate ?? null,
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
        is_new_entry:   !pastBrandKeys.has(brandKey),  // 역대 첫 등장
        is_reentry:     isReentry,
        entry_rank:     todayRank,
      });
    }
  });

  return { dailyChanges, brandEntries };
}

module.exports = { analyze };
