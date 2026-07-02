const { fetchAllSnapshots, fetchAllChanges } = require('./database');
const { makeProductKey, normalizeBrand } = require('./normalizer');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

async function generateReport() {
  console.log('\n[리포트] 대시보드 생성 중...');

  const snaps   = await fetchAllSnapshots();
  const changes = await fetchAllChanges();

  if (snaps.length === 0) {
    console.log('  데이터가 아직 없어요.');
    return;
  }

  // ── 날짜 / 카테고리 목록 ──────────────────────────────────────────
  const allDates    = [...new Set(snaps.map(r => r.snapshot_date))].sort();
  const latestDate  = allDates[allDates.length - 1];
  const CATEG_ORDER = ['skincare', 'bodycare', 'haircare', 'makeup', 'maskpack'];
  const categories  = [...new Set(snaps.map(r => r.category))].sort(
    (a, b) => {
      const ai = CATEG_ORDER.indexOf(a); const bi = CATEG_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
  );

  // ── 카테고리 × 날짜별 스냅샷 ─────────────────────────────────────
  const byCategDate = {}; // { skincare: { '2026-04-12': [...] } }
  categories.forEach(cat => { byCategDate[cat] = {}; });
  snaps.forEach(s => {
    if (!byCategDate[s.category]) byCategDate[s.category] = {};
    if (!byCategDate[s.category][s.snapshot_date]) byCategDate[s.category][s.snapshot_date] = [];
    byCategDate[s.category][s.snapshot_date].push(s);
  });
  // 각 날짜 내 rank 오름차순 정렬
  Object.values(byCategDate).forEach(dateMap =>
    Object.values(dateMap).forEach(arr => arr.sort((a, b) => +a.rank - +b.rank))
  );

  // ── 브랜드별 순위/가격 히스토리 ───────────────────────────────────
  // { skincare: { '바이오더마': { '2026-04-12': { rank, price } } } }
  const brandHistory = {};
  categories.forEach(cat => { brandHistory[cat] = {}; });
  snaps.forEach(s => {
    const cat   = s.category;
    const brand = s.brand_name_raw;
    if (!brand) return;
    if (!brandHistory[cat][brand]) brandHistory[cat][brand] = {};
    const prev = brandHistory[cat][brand][s.snapshot_date];
    // 같은 날 같은 브랜드가 여럿이면 가장 높은 순위(낮은 rank 숫자) 유지
    if (!prev || +s.rank < +prev.rank) {
      brandHistory[cat][brand][s.snapshot_date] = {
        rank:  +s.rank,
        price: +s.sale_price || null,
      };
    }
  });

  // ── 오특 날짜 ────────────────────────────────────────────────────
  const otukDates = {}; // { skincare: Set, bodycare: Set }
  categories.forEach(cat => { otukDates[cat] = new Set(); });
  snaps.filter(s => s.has_otuk === 'true' || s.has_otuk === true)
       .forEach(s => otukDates[s.category]?.add(s.snapshot_date));

  // ── 오늘 변동 데이터 (카테고리 구분용) ───────────────────────────
  // raw_snapshots에 product_key 컬럼이 없으므로, brand_name_raw+product_name_raw로 재계산해 매핑
  const keyToCategory    = {};
  const keyToProductName = {};
  const keyToBrandName   = {};
  snaps.forEach(s => {
    const k = makeProductKey(s.brand_name_raw, s.product_name_raw);
    keyToCategory[k]    = s.category;
    keyToProductName[k] = s.product_name_raw;
    keyToBrandName[k]   = s.brand_name_raw;
  });

  const todayChanges = changes.filter(c => c.snapshot_date === latestDate);
  todayChanges.forEach(c => {
    c._category     = keyToCategory[c.product_key]    || 'unknown';
    c._product_name = keyToProductName[c.product_key] || '';
    c._brand_name   = keyToBrandName[c.product_key]   || c.brand_key;
  });

  // ── 브랜드 진입 / 이탈 이력 ──────────────────────────────────────
  // raw_snapshots 전체를 기반으로 계산 → 기존 데이터 자동 포함
  // brandMovements[cat][date] = { entries: [{name, rank, isFirstEver}], exits: [{name, lastRank}] }
  const brandMovements = {};
  categories.forEach(cat => {
    brandMovements[cat] = {};
    const catDates = allDates.filter(d => byCategDate[cat]?.[d]);

    for (let i = 1; i < catDates.length; i++) {
      const prevD = catDates[i - 1];
      const currD = catDates[i];

      // 날짜별 브랜드 Map: brandKey → { name, rank }
      const prevBrands = new Map();
      const currBrands = new Map();
      (byCategDate[cat][prevD] || []).forEach(p => {
        const k = normalizeBrand(p.brand_name_raw);
        if (!prevBrands.has(k)) prevBrands.set(k, { name: p.brand_name_raw, rank: +p.rank });
      });
      (byCategDate[cat][currD] || []).forEach(p => {
        const k = normalizeBrand(p.brand_name_raw);
        if (!currBrands.has(k)) currBrands.set(k, { name: p.brand_name_raw, rank: +p.rank });
      });

      // 역대 첫 등장 판별용: currD 이전 모든 날짜에 등장한 브랜드 key 집합
      const allPrevKeys = new Set();
      catDates.slice(0, i).forEach(pd =>
        (byCategDate[cat][pd] || []).forEach(p => allPrevKeys.add(normalizeBrand(p.brand_name_raw)))
      );

      // 신규 진입: currD에 있지만 prevD에 없는 브랜드
      const entries = [];
      currBrands.forEach((info, key) => {
        if (!prevBrands.has(key))
          entries.push({ name: info.name, rank: info.rank, isFirstEver: !allPrevKeys.has(key) });
      });

      // 이탈: prevD에 있지만 currD에 없는 브랜드
      const exits = [];
      prevBrands.forEach((info, key) => {
        if (!currBrands.has(key))
          exits.push({ name: info.name, lastRank: info.rank });
      });

      if (entries.length > 0 || exits.length > 0)
        brandMovements[cat][currD] = {
          entries: entries.sort((a, b) => a.rank - b.rank),
          exits:   exits.sort((a, b) => a.lastRank - b.lastRank),
        };
    }
  });

  // ── 제품별 날짜별 데이터 (키워드 검색 + 기간 슬라이서용) ──────────
  const productMap = {};
  snaps.forEach(s => {
    const key = s.brand_name_raw + '||' + s.product_name_raw + '||' + s.category;
    if (!productMap[key]) {
      productMap[key] = {
        product_name: s.product_name_raw,
        brand_name:   s.brand_name_raw,
        category:     s.category,
        byDate: {},
      };
    }
    const e = productMap[key];
    const d = s.snapshot_date;
    if (!e.byDate[d]) e.byDate[d] = { rank: null, price: null };
    // 같은 날 여러 행이면 가장 높은 순위(낮은 숫자) 유지
    if (s.rank && (e.byDate[d].rank === null || +s.rank < e.byDate[d].rank))
      e.byDate[d].rank = +s.rank;
    if (s.sale_price) e.byDate[d].price = +s.sale_price;
  });
  const productSummary = Object.values(productMap)
    .sort((a, b) => {
      const aRanks = Object.values(a.byDate).map(v => v.rank).filter(Boolean);
      const bRanks = Object.values(b.byDate).map(v => v.rank).filter(Boolean);
      const aAvg = aRanks.length ? aRanks.reduce((s,v)=>s+v,0)/aRanks.length : 999;
      const bAvg = bRanks.length ? bRanks.reduce((s,v)=>s+v,0)/bRanks.length : 999;
      return aAvg - bAvg;
    });

  // ── 직렬화할 데이터 오브젝트 ──────────────────────────────────────
  const DATA = {
    latestDate,
    allDates,
    categories,
    catLabels: { skincare: '스킨케어', bodycare: '바디케어', haircare: '헤어케어', makeup: '메이크업', maskpack: '마스크팩' },
    byCategDate,
    brandHistory,
    otukDates: Object.fromEntries(
      Object.entries(otukDates).map(([k, v]) => [k, [...v]])
    ),
    todayChanges,
    brandMovements,
    productSummary,
  };

  // ── HTML 생성 ─────────────────────────────────────────────────────
  const html = buildHtml(DATA);
  const outPath = process.env.DASHBOARD_PATH || 'dashboard.html';
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  ✅ 대시보드 생성: ${outPath}`);

  // ── Raw 데이터 페이지 생성 ────────────────────────────────────────
  const dataHtml = buildDataHtml(snaps, changes);
  const dataPath = process.env.DATA_PAGE_PATH || path.join('..', 'data.html');
  fs.writeFileSync(dataPath, dataHtml, 'utf8');
  console.log(`  ✅ 데이터 페이지 생성: ${dataPath}`);
}

function buildHtml(D) {
  const { latestDate, allDates, categories, catLabels,
          byCategDate, brandHistory, otukDates, todayChanges, brandMovements, productSummary } = D;

  // ── 키워드 인사이트: 카테고리별 × 유형별(제품/성분/효능/마케팅) 언급 빈도 집계 ──
  // 사전(lexicon) 기반 부분일치 — "수분크림"에서 '수분'(효능)·'크림'(제품) 둘 다 카운트.
  // 언급수 = 해당 키워드를 상품명에 포함한 상품 개수(카테고리 TOP100 기준).
  const KW_LEX = {
    '제품': ['토너','세럼','앰플','크림','로션','에센스','미스트','오일','스틱','쿠션','파운데이션','틴트',
      '립','마스카라','아이라이너','섀도','블러셔','치크','컨실러','파우더','프라이머','클렌징','폼','스크럽',
      '필링','마스크','팩','패드','샴푸','트리트먼트','컨디셔너','바디워시','바디로션','바디크림','데오드란트',
      '핸드크림','선크림','선스틱','선세럼','선쿠션','젤','비누','밤','왁스','에어','스프레이'],
    '성분': ['PDRN','시카','콜라겐','히알루론산','레티놀','나이아신아마이드','세라마이드','판테놀','어성초',
      '병풀','마데카','펩타이드','비타민','아연','살리실산','스쿠알란','티트리','녹차','프로폴리스','달팽이',
      '감초','알로에','카페인','아데노신','프로바이오','토코페롤','무씨','쌀','복숭아','도라지','캐모마일','centella'],
    '효능': ['진정','수분','보습','모공','미백','주름','탄력','리페어','쿨링','각질','트러블','재생','톤업',
      '영양','볼륨','손상','민감','저자극','약산성','흔적','홍조','촉촉','딥클렌징','세정','지속','커버','매트',
      '광채','글로우','컬','두피','탈모','향','퍼퓸','리프팅','브라이트닝','안티에이징','수분감','속건조','블랙헤드'],
    '마케팅': ['올영픽','기획','한정','대용량','증정','단독','1위','1등','NEW','세일','특가','리필','더블',
      '세트','에디션','신상','리뉴얼','업그레이드','사은품','쿠폰','오특','무료','최초','최대','선물','행사',
      'PICK','증량','한정수량','베스트','인기','추천'],
  };
  const KW_TYPES = ['제품','성분','효능','마케팅'];

  // 월 목록 (YYYY-MM, 오름차순) + 월별×카테고리×유형 집계
  const kwMonths = [...new Set(allDates.map(d => d.slice(0, 7)))].sort();
  // 월별 집계: 해당 월에 등장한 고유 상품(상품명 기준) 중 키워드 포함 상품 수
  const keywordByMonth = {};
  kwMonths.forEach(month => {
    const monthDates = allDates.filter(d => d.slice(0, 7) === month);
    const perCat = {};
    categories.forEach(cat => {
      const nameSet = new Set();
      monthDates.forEach(d => (byCategDate[cat]?.[d] || []).forEach(p => {
        if (p.product_name_raw) nameSet.add(p.product_name_raw.toLowerCase());
      }));
      const names = [...nameSet];
      const byType = {};
      KW_TYPES.forEach(type => {
        byType[type] = KW_LEX[type]
          .map(kw => ({ word: kw, count: names.filter(n => n.includes(kw.toLowerCase())).length }))
          .filter(r => r.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);
      });
      perCat[cat] = byType;
    });
    keywordByMonth[month] = perCat;
  });
  const kwLatestMonth = kwMonths[kwMonths.length - 1] || '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>올리브영 랭킹 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#f4f6f9;color:#333;}
header{background:linear-gradient(135deg,#1b4332,#40916c);color:#fff;padding:20px 28px;}
header h1{font-size:20px;font-weight:700;}
header p{font-size:12px;opacity:.8;margin-top:3px;}
.wrap{max-width:1280px;margin:0 auto;padding:20px 16px;}

/* 카테고리 탭 */
.cat-tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;}
.cat-tab{padding:8px 22px;border-radius:20px;border:2px solid #ddd;background:#fff;
  font-size:14px;font-weight:600;cursor:pointer;transition:.2s;}
.cat-tab.active{background:#40916c;color:#fff;border-color:#40916c;}
.cat-tab:hover:not(.active){border-color:#40916c;color:#40916c;}

/* 카드 */
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.07);margin-bottom:18px;}
.card h2{font-size:14px;font-weight:700;color:#1b4332;margin-bottom:14px;}
/* TOP10/100 토글: 11위 이후 행은 기본 숨김(전체 탭=TOP10), 개별 카테고리 탭에서만 표시(TOP100) */
tr.rank-rest{display:none;}
body.show-rest tr.rank-rest{display:table-row;}
/* 키워드 인사이트: 월 선택 바 */
.kw-month-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border-radius:12px;
  padding:14px 18px;box-shadow:0 2px 8px rgba(0,0,0,.07);margin-bottom:18px;font-weight:700;color:#1b4332;font-size:14px;}
.kw-month-bar select{padding:6px 12px;border-radius:8px;border:1.5px solid #b7e4c7;background:#f6fbf8;
  font-size:13px;font-weight:600;color:#1b4332;cursor:pointer;}
.kw-month-bar .kw-hint{font-weight:400;font-size:12px;color:#888;margin-left:auto;}
/* 키워드 인사이트: 유형별 컬럼 + 칩 */
.kw-types{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
@media(max-width:700px){.kw-types{grid-template-columns:1fr 1fr;}}
.kw-type-h{font-size:12px;font-weight:800;padding-bottom:5px;margin-bottom:9px;border-bottom:2px solid;}
.kw-t-prod{color:#2d6a4f;border-color:#95d5b2;}
.kw-t-ingr{color:#1565c0;border-color:#90caf9;}
.kw-t-effi{color:#c2185b;border-color:#f48fb1;}
.kw-t-mkt {color:#e65100;border-color:#ffcc80;}
.kw-chip{display:inline-block;background:#f4f6f9;border-radius:14px;padding:4px 10px;margin:0 5px 6px 0;font-size:12px;color:#333;}
.kw-chip b{margin-left:5px;color:#40916c;font-weight:700;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px;}
.full{grid-column:1/-1;}

/* 통계 박스 */
.stat{text-align:center;padding:14px;border-radius:10px;}
.stat .n{font-size:28px;font-weight:800;}
.stat .l{font-size:12px;color:#666;margin-top:3px;}
.s-green{background:#e8f5e9;color:#1b4332;}
.s-blue{background:#e3f2fd;color:#1565c0;}
.s-orange{background:#fff3e0;color:#e65100;}
.s-pink{background:#fce4ec;color:#880e4f;}

/* 오특 배너 */
.otuk-banner{background:linear-gradient(135deg,#ff6b35,#f7c59f);color:#fff;
  border-radius:12px;padding:14px 20px;margin-bottom:18px;display:flex;align-items:center;gap:12px;}
.otuk-banner .ico{font-size:28px;}
.otuk-banner h3{font-size:15px;font-weight:700;}
.otuk-banner p{font-size:12px;opacity:.9;}

/* 테이블 */
table{width:100%;border-collapse:collapse;font-size:13px;}
th{background:#f0f7f4;padding:7px 10px;text-align:left;font-size:12px;color:#555;border-bottom:2px solid #dde9e5;}
td{padding:7px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle;}
tr:last-child td{border-bottom:none;}
tr:hover td{background:#f9fdf9;}
.rb{display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:700;}
.r1{background:#FFD700;color:#333;}.r2{background:#C0C0C0;color:#333;}
.r3{background:#CD7F32;color:#fff;}.rn{background:#e8f5e9;color:#1b4332;}
.up{color:#e74c3c;font-weight:700;}.dn{color:#3498db;font-weight:700;}
.tag{display:inline-block;padding:1px 6px;border-radius:8px;font-size:11px;margin:1px;}
.t-sale{background:#ffe0e0;color:#c0392b;}.t-coupon{background:#fff3cd;color:#856404;}
.t-otuk{background:#ff6b35;color:#fff;font-weight:700;}
.t-other{background:#e8eaf6;color:#3949ab;}
.price-dn{color:#e74c3c;}.price-up{color:#3498db;}
.otuk-dot{display:inline-block;width:8px;height:8px;background:#ff6b35;border-radius:50%;margin-right:4px;}
.t-first{background:#e3f2fd;color:#1565c0;font-weight:700;}
.t-exit{background:#fce4ec;color:#c62828;}

/* 브랜드 분석 */
.brand-select-area{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;}
.brand-select-area select{padding:8px 12px;border-radius:8px;border:1.5px solid #ddd;
  font-size:13px;min-width:200px;cursor:pointer;}
.brand-select-area select:focus{outline:none;border-color:#40916c;}
.brand-detail{display:none;}
.brand-detail.show{display:block;}
.chart-wrap{height:260px;position:relative;}
.chart-wrap2{height:220px;position:relative;}
.no-data{color:#aaa;font-size:13px;padding:30px 0;text-align:center;}

/* 날짜 탭 */
.date-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.date-btn{padding:5px 13px;border:1.5px solid #ddd;border-radius:16px;
  font-size:12px;cursor:pointer;background:#fff;transition:.15s;}
.date-btn.active{background:#1b4332;color:#fff;border-color:#1b4332;}
.date-btn.otuk-day{border-color:#ff6b35;color:#ff6b35;}
.date-btn.active.otuk-day{background:#ff6b35;color:#fff;}

.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
.mv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;}

@media(max-width:768px){
  header{padding:12px 14px;}
  header h1{font-size:17px;}
  .wrap{padding:12px 10px;}
  .grid2,.grid3{grid-template-columns:1fr;}
  .grid3{grid-template-columns:repeat(2,1fr);}
  .cat-tabs{position:sticky;top:0;z-index:100;background:#f4f6f9;
    overflow-x:auto;flex-wrap:nowrap;-webkit-overflow-scrolling:touch;
    padding:8px 10px 8px;margin:0 -10px 14px;border-bottom:1px solid #e0e0e0;}
  .cat-tab{white-space:nowrap;padding:7px 14px;font-size:13px;}
  .card{padding:12px;border-radius:10px;margin-bottom:12px;}
  .card h2{font-size:13px;}
  table{font-size:12px;}
  th,td{padding:5px 7px;}
  .stat .n{font-size:22px;}
  .stat{padding:10px;}
  .brand-select-area{flex-direction:column;align-items:stretch;}
  .brand-select-area select{min-width:0;width:100%;}
  .brand-select-area span{margin-top:4px;}
  .chart-wrap{height:190px;}
  .chart-wrap2{height:150px;}
  .date-btn{font-size:11px;padding:4px 9px;}
  .mv-grid{grid-template-columns:1fr;}
  .otuk-banner{padding:10px 14px;gap:8px;}
  .otuk-banner .ico{font-size:22px;}
}
@media(max-width:480px){
  .grid3{grid-template-columns:1fr 1fr;}
  header h1{font-size:15px;}
  header p{font-size:11px;}
  .stat .n{font-size:18px;}
  .stat .l{font-size:11px;}
}

/* 키워드 검색 */
#keyword-search-section{display:none;}
.kw-input-wrap{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;}
.kw-input-wrap input[type=text]{flex:1;min-width:200px;padding:10px 16px;border-radius:24px;
  border:2px solid #40916c;font-size:15px;outline:none;transition:.2s;}
.kw-input-wrap input[type=text]:focus{box-shadow:0 0 0 3px rgba(64,145,108,.2);}
.kw-result-meta{font-size:12px;color:#888;white-space:nowrap;}
.kw-slicer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  background:#f8fdf9;border:1px solid #d4edda;border-radius:10px;
  padding:10px 14px;margin-bottom:16px;}
.kw-slicer-label{font-size:12px;font-weight:700;color:#555;margin-right:4px;}
.kw-period{padding:5px 14px;border-radius:16px;border:1.5px solid #ccc;
  background:#fff;font-size:12px;font-weight:600;cursor:pointer;transition:.15s;}
.kw-period.active{background:#40916c;color:#fff;border-color:#40916c;}
.kw-period:hover:not(.active){border-color:#40916c;color:#40916c;}
.kw-divider{color:#ccc;font-size:12px;}
.kw-date-range{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.kw-date-range input[type=date]{padding:4px 8px;border-radius:8px;border:1.5px solid #ddd;
  font-size:12px;cursor:pointer;color:#333;}
.kw-date-range input[type=date]:focus{outline:none;border-color:#40916c;}
.kw-date-sep{font-size:12px;color:#888;}
.kw-tag{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;}
.kw-tag-skin{background:#e8f5e9;color:#1b4332;}
.kw-tag-body{background:#e3f2fd;color:#1565c0;}
.kw-tag-hair{background:#fff3e0;color:#e65100;}
.kw-tag-make{background:#fce4ec;color:#880e4f;}
.kw-tag-mask{background:#f3e5f5;color:#6a1b9a;}
.kw-empty{color:#bbb;font-size:14px;text-align:center;padding:40px 0;}
</style>
</head>
<body>
<header style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
  <div>
    <h1>🛍️ 올리브영 랭킹 대시보드</h1>
    <p>기준: ${latestDate} &nbsp;|&nbsp; 수집일: ${allDates.length}일 &nbsp;|&nbsp; 카테고리: ${categories.map(c => catLabels[c]||c).join(', ')}</p>
  </div>
  <a href="data.html" style="padding:7px 16px;border-radius:20px;border:1.5px solid rgba(255,255,255,.6);color:#fff;font-size:12px;text-decoration:none;white-space:nowrap;">📦 Raw 데이터</a>
</header>

<div class="wrap">

  <!-- 카테고리 탭 -->
  <div class="cat-tabs">
    <button class="cat-tab active" onclick="switchCat('all',this)">📊 전체</button>
    ${categories.map(c => `<button class="cat-tab" onclick="switchCat('${c}',this)">${catLabels[c]||c}</button>`).join('')}
    <button class="cat-tab" onclick="switchCat('keyword',this)">🔍 키워드 검색</button>
  </div>

  <!-- 키워드 인사이트: 월 선택 바 -->
  <div id="kw-month-bar" class="kw-month-bar">
    <span>🔤 키워드 인사이트 &nbsp;·&nbsp; 📅 기간</span>
    <select id="kw-month-sel" onchange="renderKeywords(this.value)">
      ${kwMonths.slice().reverse().map(m => {
        const [y,mo] = m.split('-');
        return `<option value="${m}"${m===kwLatestMonth?' selected':''}>${y}년 ${+mo}월</option>`;
      }).join('')}
    </select>
    <span class="kw-hint">상품명 언급 빈도(해당 월 등장 상품 수)</span>
  </div>

  <!-- 키워드 인사이트: 카테고리별 카드 (내용은 renderKeywords()가 채움) -->
  ${categories.map(cat => `<div class="card cat-section kw-card" data-cat="${cat}">
    <h2>🔤 ${catLabels[cat]||cat} 키워드 인사이트</h2>
    <div class="kw-types" id="kwtypes-${cat}"></div>
  </div>`).join('')}

  <!-- TOP10 (카테고리별) -->
  ${categories.map(cat => {
    const todaySnaps  = byCategDate[cat]?.[latestDate] || [];

    return `<div class="cat-section" data-cat="${cat}">
      <div class="card">
        <h2>🏆 ${catLabels[cat]||cat} 오늘 TOP <span class="top-n">10</span></h2>
        <div class="tbl-wrap"><table><thead><tr><th>#</th><th>브랜드</th><th>상품명</th><th>판매가</th><th>할인</th><th>배지</th></tr></thead><tbody>
        ${todaySnaps.slice(0,100).map(p => {
          const rc  = +p.rank === 1 ? 'r1' : +p.rank === 2 ? 'r2' : +p.rank === 3 ? 'r3' : 'rn';
          const disc = p.price_discount_rate ? Math.round(+p.price_discount_rate*100)+'%' : '-';
          const badges = (p.badges||'').split(',').filter(Boolean).map(b => {
            const cls = b==='오특'?'t-otuk':b==='세일'?'t-sale':b==='쿠폰'?'t-coupon':'t-other';
            return `<span class="tag ${cls}">${b}</span>`;
          }).join('');
          return `<tr class="${+p.rank > 10 ? 'rank-rest' : ''}">
            <td><span class="rb ${rc}">${p.rank}</span></td>
            <td><a href="#" onclick="selectBrand('${cat}','${p.brand_name_raw.replace(/'/g,"\\'")}');return false;"
              style="color:#1b4332;font-weight:600;text-decoration:none;">${p.brand_name_raw}</a></td>
            <td style="max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${p.product_name_raw}</td>
            <td>${p.sale_price ? (+p.sale_price).toLocaleString()+'원' : '-'}</td>
            <td>${disc}</td>
            <td>${badges}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
      </div>
    </div>`;
  }).join('')}

  <!-- 순위 추이 차트 (카테고리별) -->
  ${categories.map(cat => {
    const catDates = allDates.filter(d => byCategDate[cat]?.[d]);
    const recentDates = catDates.slice(-14);
    const topBrands = (byCategDate[cat]?.[latestDate] || []).slice(0,10).map(p => p.brand_name_raw);
    const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#F7DC6F','#DDA0DD','#98D8C8','#BB8FCE','#85C1E9','#FFEAA7'];
    const chartDatasets = topBrands.map((brand, i) => ({
      label: brand,
      data: recentDates.map(d => brandHistory[cat]?.[brand]?.[d]?.rank ?? null),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '33',
      tension: 0.3, spanGaps: true, pointRadius: 4,
    }));

    return `<div class="card cat-section cat-only" data-cat="${cat}">
      <h2>📈 ${catLabels[cat]||cat} TOP10 순위 추이</h2>
      ${recentDates.length < 2
        ? '<p class="no-data">데이터가 2일 이상 쌓이면 차트가 표시됩니다.</p>'
        : `<div class="chart-wrap"><canvas id="rankChart-${cat}"></canvas></div>`
      }
      <script>
      (function(){
        if(${recentDates.length} < 2) return;
        new Chart(document.getElementById('rankChart-${cat}'), {
          type:'line',
          data:{ labels:${JSON.stringify(recentDates)}, datasets:${JSON.stringify(chartDatasets)} },
          options:{
            responsive:true, maintainAspectRatio:false,
            scales:{
              y:{ reverse:true, min:1, ticks:{stepSize:1}, title:{display:true,text:'순위'} },
              x:{ title:{display:true,text:'날짜'} }
            },
            plugins:{
              legend:{position:window?.innerWidth<600?'bottom':'right',labels:{font:{size:11},boxWidth:12}},
              tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.raw+'위'}}
            }
          }
        });
      })();
      </script>
    </div>`;
  }).join('')}

  <!-- 키워드 검색 -->
  <div id="keyword-search-section">
    <div class="card full">
      <h2>🔍 키워드 검색</h2>
      <p style="font-size:12px;color:#888;margin-bottom:14px;">제품명 또는 브랜드명으로 검색 · 기간을 선택하면 해당 구간 통계로 재계산됩니다.</p>
      <div class="kw-input-wrap">
        <input id="kw-input" type="text" placeholder="검색어를 입력하세요...  예: 앰플, 선크림, 이니스프리" oninput="kwSearch()">
        <span class="kw-result-meta" id="kw-meta"></span>
      </div>
      <div class="kw-slicer">
        <span class="kw-slicer-label">기간</span>
        <button class="kw-period active" onclick="kwSetPeriod(0,this)">전체</button>
        <button class="kw-period" onclick="kwSetPeriod(7,this)">7일</button>
        <button class="kw-period" onclick="kwSetPeriod(14,this)">14일</button>
        <button class="kw-period" onclick="kwSetPeriod(30,this)">30일</button>
        <span class="kw-divider">|</span>
        <div class="kw-date-range">
          <span class="kw-slicer-label">직접 선택</span>
          <input type="date" id="kw-from" onchange="kwSetCustom()">
          <span class="kw-date-sep">~</span>
          <input type="date" id="kw-to" onchange="kwSetCustom()">
        </div>
      </div>
      <div id="kw-results"><p class="kw-empty">검색어를 입력하면 결과가 표시됩니다.</p></div>
    </div>
  </div>

  <!-- 브랜드 분석 -->
  <div class="card full" id="brand-analysis-card">
    <h2>🔍 브랜드별 상세 분석</h2>
    <div class="brand-select-area">
      <span style="font-size:13px;font-weight:600;color:#555;">카테고리</span>
      <select id="brand-cat-sel" onchange="refreshBrandList()">
        ${categories.map(c => `<option value="${c}">${catLabels[c]||c}</option>`).join('')}
      </select>
      <span style="font-size:13px;font-weight:600;color:#555;">브랜드</span>
      <select id="brand-sel" onchange="showBrandDetail()">
        <option value="">-- 브랜드를 선택하세요 --</option>
      </select>
    </div>

    <div id="brand-detail" class="brand-detail">
      <div class="grid2" style="margin-bottom:14px;">
        <div>
          <p style="font-size:12px;color:#666;margin-bottom:8px;">📈 순위 추이 (낮을수록 상위)</p>
          <div class="chart-wrap2"><canvas id="brandRankChart"></canvas></div>
        </div>
        <div>
          <p style="font-size:12px;color:#666;margin-bottom:8px;">💰 가격 추이 (판매가)</p>
          <div class="chart-wrap2"><canvas id="brandPriceChart"></canvas></div>
        </div>
      </div>
      <div id="brand-products-wrap"></div>
    </div>
  </div>


</div>

<script>
// ── 데이터 ────────────────────────────────────────────────────────
// BRAND_HISTORY: 전 기간 순위·가격 요약 (브랜드 차트용)
const BRAND_HISTORY = ${JSON.stringify(D.brandHistory)};
const ALL_DATES     = ${JSON.stringify(D.allDates)};
const CAT_LABELS    = ${JSON.stringify(D.catLabels)};
const PRODUCT_SUMMARY = ${JSON.stringify(productSummary)};
// 키워드 인사이트: 월별 × 카테고리 × 유형 집계 데이터
const KEYWORD_BY_MONTH = ${JSON.stringify(keywordByMonth)};
const KW_TYPES = ${JSON.stringify(KW_TYPES)};
const KW_CATS  = ${JSON.stringify(categories)};
// 카테고리별 전체 기간 브랜드 이름 목록 (순위 이탈 브랜드 포함)
const BRAND_NAMES_BY_CAT = ${JSON.stringify((() => {
  const out = {};
  categories.forEach(cat => {
    const names = new Set();
    Object.values(byCategDate[cat] || {}).forEach(daySnaps =>
      daySnaps.forEach(p => { if (p.brand_name_raw) names.add(p.brand_name_raw); })
    );
    out[cat] = [...names].sort();
  });
  return out;
})())};
// 오늘 스냅샷만 (브랜드 상세 분석 상품 목록용)
const TODAY_SNAPS = ${JSON.stringify((() => {
  const out = {};
  categories.forEach(cat => {
    out[cat] = (byCategDate[cat]?.[latestDate] || []).map(p => ({
      rank: p.rank,
      brand_name_raw: p.brand_name_raw,
      product_name_raw: p.product_name_raw,
      sale_price: p.sale_price,
      list_price: p.list_price,
      price_discount_rate: p.price_discount_rate,
      badges: p.badges,
      has_otuk: p.has_otuk,
      is_sold_out: p.is_sold_out,
    }));
  });
  return out;
})())};

// ── 카테고리 탭 전환 ──────────────────────────────────────────────
let currentCat = 'all';
function switchCat(cat, btn) {
  currentCat = cat;

  // 탭 버튼 active 상태
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // 키워드 검색 탭 처리
  const kwSection = document.getElementById('keyword-search-section');
  const kwMonthBar = document.getElementById('kw-month-bar');
  const mainCards = ['brand-analysis-card'];
  if (cat === 'keyword') {
    kwSection.style.display = 'block';
    document.querySelectorAll('[data-cat]').forEach(el => el.style.display = 'none');
    mainCards.forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
    if (kwMonthBar) kwMonthBar.style.display = 'none';
    document.body.classList.remove('show-rest');
    document.getElementById('kw-input').focus();
    return;
  }

  // 일반 탭: 키워드 검색 섹션 숨기기
  kwSection.style.display = 'none';
  mainCards.forEach(id => { const el=document.getElementById(id); if(el) el.style.display=''; });
  if (kwMonthBar) kwMonthBar.style.display = '';

  // 전체 탭 = TOP10만 / 개별 카테고리 탭 = TOP100 표시
  const showRest = cat !== 'all';
  document.body.classList.toggle('show-rest', showRest);
  document.querySelectorAll('.top-n').forEach(el => { el.textContent = showRest ? '100' : '10'; });

  // data-cat 속성이 있는 모든 요소 표시/숨김
  // (cat-only 요소는 개별 카테고리 탭에서만 표시 — 전체 탭에서는 숨김)
  document.querySelectorAll('[data-cat]').forEach(el => {
    const matchCat  = (cat === 'all' || cat === el.dataset.cat);
    const hideInAll = (cat === 'all' && el.classList.contains('cat-only'));
    el.style.display = (matchCat && !hideInAll) ? '' : 'none';
  });

  // 브랜드 드롭다운 카테고리 동기화
  if (cat !== 'all') {
    document.getElementById('brand-cat-sel').value = cat;
    refreshBrandList();
  }
}

// 초기 상태: 기본 탭이 '전체'이므로 cat-only(순위 추이 차트) 숨김.
// (차트는 로드 시 가시 상태로 생성되어 크기가 정상 계산된 뒤 여기서 숨겨지므로,
//  이후 카테고리 탭에서 다시 보일 때 레이아웃이 깨지지 않는다.)
document.querySelectorAll('.cat-only').forEach(el => { el.style.display = 'none'; });

// ── 키워드 인사이트: 선택 월의 카테고리별 카드 렌더링 ──────────────
const KW_TYPE_CLASS = { '제품':'prod', '성분':'ingr', '효능':'effi', '마케팅':'mkt' };
function renderKeywords(month) {
  const perCat = KEYWORD_BY_MONTH[month] || {};
  KW_CATS.forEach(cat => {
    const box = document.getElementById('kwtypes-' + cat);
    if (!box) return;
    const byType = perCat[cat] || {};
    const hasAny = KW_TYPES.some(t => (byType[t] || []).length > 0);
    if (!hasAny) {
      box.innerHTML = '<p class="no-data" style="grid-column:1/-1;">이 달 추출된 키워드가 없어요.</p>';
      return;
    }
    box.innerHTML = KW_TYPES.map(type => {
      const rows = byType[type] || [];
      const chips = rows.length === 0
        ? '<span class="no-data" style="font-size:12px;">-</span>'
        : rows.map(r => '<span class="kw-chip">' + r.word + '<b>' + r.count + '</b></span>').join('');
      return '<div class="kw-type"><div class="kw-type-h kw-t-' + KW_TYPE_CLASS[type] + '">' + type + '</div>' + chips + '</div>';
    }).join('');
  });
}
// 초기 렌더: 최신 월
(function(){ const sel = document.getElementById('kw-month-sel'); if (sel && sel.value) renderKeywords(sel.value); })();

// ── 키워드 검색 ───────────────────────────────────────────────────
const KW_CAT_TAG = {
  skincare: ['kw-tag-skin', '스킨케어'],
  bodycare: ['kw-tag-body', '바디케어'],
  haircare: ['kw-tag-hair', '헤어케어'],
  makeup:   ['kw-tag-make', '메이크업'],
  maskpack: ['kw-tag-mask', '마스크팩'],
};

// 날짜 범위 상태
let kwDateFrom = '';
let kwDateTo   = '';

// 슬라이서 초기화: 날짜 input 범위 설정 + 기본값 전체
(function initSlicer() {
  const dates = ALL_DATES;
  if (!dates.length) return;
  const min = dates[0];
  const max = dates[dates.length - 1];
  const fromEl = document.getElementById('kw-from');
  const toEl   = document.getElementById('kw-to');
  fromEl.min = toEl.min = min;
  fromEl.max = toEl.max = max;
  fromEl.value = min;
  toEl.value   = max;
  kwDateFrom = min;
  kwDateTo   = max;
})();

function kwSetPeriod(days, btn) {
  document.querySelectorAll('.kw-period').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const dates = ALL_DATES;
  if (!dates.length) return;
  const max = dates[dates.length - 1];
  let min;
  if (days === 0) {
    min = dates[0];
  } else {
    const cutoff = new Date(max);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutStr = cutoff.toISOString().slice(0, 10);
    min = dates.find(d => d >= cutStr) || dates[0];
  }
  kwDateFrom = min;
  kwDateTo   = max;
  document.getElementById('kw-from').value = min;
  document.getElementById('kw-to').value   = max;
  kwSearch();
}

function kwSetCustom() {
  const from = document.getElementById('kw-from').value;
  const to   = document.getElementById('kw-to').value;
  if (!from || !to) return;
  kwDateFrom = from;
  kwDateTo   = to <= from ? from : to;
  document.querySelectorAll('.kw-period').forEach(b => b.classList.remove('active'));
  kwSearch();
}

function kwComputeStats(product) {
  const entries = Object.entries(product.byDate)
    .filter(([d]) => d >= kwDateFrom && d <= kwDateTo);
  const ranks  = entries.map(([,v]) => v.rank ).filter(v => v != null);
  const prices = entries.map(([,v]) => v.price).filter(v => v != null);
  const dates  = entries.map(([d]) => d).sort();
  if (!dates.length) return null;
  return {
    avg_rank:   ranks.length  ? Math.round(ranks.reduce((a,b)=>a+b,0)/ranks.length*10)/10 : null,
    best_rank:  ranks.length  ? Math.min(...ranks)  : null,
    worst_rank: ranks.length  ? Math.max(...ranks)  : null,
    avg_price:  prices.length ? Math.round(prices.reduce((a,b)=>a+b,0)/prices.length) : null,
    min_price:  prices.length ? Math.min(...prices) : null,
    max_price:  prices.length ? Math.max(...prices) : null,
    count:      dates.length,
    first_date: dates[0],
    last_date:  dates[dates.length-1],
  };
}

function kwSearch() {
  const q         = document.getElementById('kw-input').value.trim().toLowerCase();
  const meta      = document.getElementById('kw-meta');
  const container = document.getElementById('kw-results');

  if (!q) {
    meta.textContent = '';
    container.innerHTML = '<p class="kw-empty">검색어를 입력하면 결과가 표시됩니다.</p>';
    return;
  }

  const matched = PRODUCT_SUMMARY.filter(p =>
    (p.product_name||'').toLowerCase().includes(q) ||
    (p.brand_name||'').toLowerCase().includes(q)
  );

  // 기간 필터 적용 후 통계 계산
  const results = matched
    .map(p => ({ ...p, stats: kwComputeStats(p) }))
    .filter(p => p.stats !== null)
    .sort((a, b) => (a.stats.avg_rank||999) - (b.stats.avg_rank||999));

  meta.textContent = results.length ? results.length + '개 제품' : '';

  if (results.length === 0) {
    container.innerHTML = '<p class="kw-empty">"' + q + '" 검색 결과가 없습니다.</p>';
    return;
  }

  const rows = results.map(p => {
    const s = p.stats;
    const [tagCls, tagLabel] = KW_CAT_TAG[p.category] || ['kw-tag-skin', p.category];
    return '<tr>' +
      '<td><span class="kw-tag ' + tagCls + '">' + tagLabel + '</span></td>' +
      '<td style="font-weight:600;">' + (p.brand_name||'-') + '</td>' +
      '<td style="max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="' + (p.product_name||'').replace(/"/g,'&quot;') + '">' + (p.product_name||'-') + '</td>' +
      '<td style="text-align:center;font-weight:700;color:#1b4332;">' + (s.avg_rank  != null ? s.avg_rank  + '위' : '-') + '</td>' +
      '<td style="text-align:center;color:#e74c3c;font-weight:700;">' + (s.best_rank != null ? s.best_rank + '위' : '-') + '</td>' +
      '<td style="text-align:center;color:#3498db;">'                 + (s.worst_rank!= null ? s.worst_rank+ '위' : '-') + '</td>' +
      '<td style="text-align:right;">'                                 + (s.avg_price != null ? s.avg_price.toLocaleString()+'원' : '-') + '</td>' +
      '<td style="text-align:right;color:#e74c3c;">'                  + (s.min_price != null ? s.min_price.toLocaleString()+'원' : '-') + '</td>' +
      '<td style="text-align:right;color:#3498db;">'                  + (s.max_price != null ? s.max_price.toLocaleString()+'원' : '-') + '</td>' +
      '<td style="text-align:center;">' + s.count + '일</td>' +
      '<td style="text-align:center;font-size:12px;color:#999;">' + (s.first_date||'-') + '</td>' +
      '<td style="text-align:center;font-size:12px;color:#999;">' + (s.last_date ||'-') + '</td>' +
    '</tr>';
  }).join('');

  container.innerHTML =
    '<div class="tbl-wrap"><table>' +
    '<thead><tr>' +
    '<th>카테고리</th><th>브랜드</th><th>제품명</th>' +
    '<th style="text-align:center;">평균 순위</th>' +
    '<th style="text-align:center;">최고 순위</th>' +
    '<th style="text-align:center;">최저 순위</th>' +
    '<th style="text-align:right;">평균 가격</th>' +
    '<th style="text-align:right;">최저가</th>' +
    '<th style="text-align:right;">최고가</th>' +
    '<th style="text-align:center;">노출일수</th>' +
    '<th style="text-align:center;">첫 등장</th>' +
    '<th style="text-align:center;">마지막 등장</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

// ── 날짜 히스토리 탭 ─────────────────────────────────────────────
function showHistDate(cat, date, btn) {
  btn.closest('.card').querySelectorAll('[id^="hist-'+cat+'-"]').forEach(el => el.style.display = 'none');
  btn.closest('.card').querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('hist-' + cat + '-' + date).style.display = 'block';
  btn.classList.add('active');
}

// ── 브랜드 선택 ───────────────────────────────────────────
function refreshBrandList() {
  const cat = document.getElementById('brand-cat-sel').value;
  const brands = BRAND_NAMES_BY_CAT[cat] || [];
  const sel = document.getElementById('brand-sel');
  sel.innerHTML = '<option value="">-- 브랜드를 선택하세요 --</option>' +
    brands.map(b => '<option value="' + b.replace(/"/g, '&quot;') + '">' + b + '</option>').join('');
  document.getElementById('brand-detail').classList.remove('show');
}

// ── 브랜드 상세 표시 ─────────────────────────────────────────────
let rankChart = null, priceChart = null;

function selectBrand(cat, brand) {
  document.getElementById('brand-cat-sel').value = cat;
  refreshBrandList();
  document.getElementById('brand-sel').value = brand;
  showBrandDetail();
  document.getElementById('brand-analysis-card').scrollIntoView({ behavior: 'smooth' });
}

function showBrandDetail() {
  const cat    = document.getElementById('brand-cat-sel').value;
  const brand  = document.getElementById('brand-sel').value;
  const detail = document.getElementById('brand-detail');

  if (!brand) { detail.classList.remove('show'); return; }

  const history = BRAND_HISTORY[cat]?.[brand] || {};
  const dates   = ALL_DATES.filter(d => history[d]);
  const ranks   = dates.map(d => history[d].rank);
  const prices  = dates.map(d => history[d].price);

  // 순위 차트
  if (rankChart) rankChart.destroy();
  rankChart = new Chart(document.getElementById('brandRankChart'), {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: brand + ' 순위',
        data: ranks,
        borderColor: '#40916c', backgroundColor: 'rgba(64,145,108,.15)',
        tension: 0.3, pointRadius: 5, fill: true,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { reverse: true, min: 1, title: { display: true, text: '순위' }, ticks: { stepSize: 1 } },
        x: { title: { display: true, text: '날짜' } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.raw + '위' } } }
    }
  });

  // 가격 차트
  if (priceChart) priceChart.destroy();
  priceChart = new Chart(document.getElementById('brandPriceChart'), {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: brand + ' 판매가',
        data: prices,
        borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,.1)',
        tension: 0.3, pointRadius: 5, fill: true,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { title: { display: true, text: '가격 (원)' },
          ticks: { callback: v => v.toLocaleString() + '원' } },
        x: { title: { display: true, text: '날짜' } }
      },
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: c => (c.raw||0).toLocaleString() + '원' } }
      }
    }
  });

  // 해당 브랜드 상품 테이블
  const brandProds = (TODAY_SNAPS[cat] || []).filter(p => p.brand_name_raw === brand);

  const tableHtml = brandProds.length === 0 ? '<p class="no-data">오늘 랭킹에 없음</p>' :
    '<p style="font-size:12px;color:#666;margin-bottom:8px;">오늘 랭킹 상품</p>' +
    '<div class="tbl-wrap"><table><thead><tr><th>순위</th><th>상품명</th><th>정가</th><th>판매가</th><th>할인율</th><th>배지</th></tr></thead><tbody>' +
    brandProds.map(p => {
      const disc = p.price_discount_rate ? Math.round(+p.price_discount_rate*100)+'%' : '-';
      const badges = (p.badges||'').split(',').filter(Boolean).map(b => {
        const cls = b==='오특'?'t-otuk':b==='세일'?'t-sale':b==='쿠폰'?'t-coupon':'t-other';
        return '<span class="tag '+cls+'">'+b+'</span>';
      }).join('');
      return '<tr><td>'+p.rank+'위</td><td>'+p.product_name_raw+'</td><td>'+
        (p.list_price?(+p.list_price).toLocaleString()+'원':'-')+'</td><td>'+
        (p.sale_price?(+p.sale_price).toLocaleString()+'원':'-')+'</td><td>'+disc+'</td><td>'+badges+'</td></tr>';
    }).join('') + '</tbody></table></div>';

  document.getElementById('brand-products-wrap').innerHTML = tableHtml;
  detail.classList.add('show');
}

// 초기화: 브랜드 목록 로드
refreshBrandList();
</script>
</body>
</html>`;
}

// ── Raw 데이터 페이지 생성 ─────────────────────────────────────────────
function buildDataHtml(snaps, changes) {
  const allDates   = [...new Set(snaps.map(r => r.snapshot_date))].sort();
  const categories = [...new Set(snaps.map(r => r.category))];
  const catLabels  = { skincare: '스킨케어', bodycare: '바디케어', haircare: '헤어케어', makeup: '메이크업', maskpack: '마스크팩' };
  const latestDate = allDates[allDates.length - 1] || '';

  const dateOptions    = allDates.map(d => `<option value="${d}">${d}</option>`).join('');
  const catOptions     = categories.map(c => `<option value="${c}">${catLabels[c]||c}</option>`).join('');
  const snapCountLabel = snaps.length.toLocaleString();
  const chgCountLabel  = changes.length.toLocaleString();

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raw 데이터 | 올리브영 랭킹</title>
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#f4f6f9;color:#333;}
header{background:linear-gradient(135deg,#1b4332,#40916c);color:#fff;padding:18px 28px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;}
header h1{font-size:18px;font-weight:700;}
header p{font-size:12px;opacity:.8;margin-top:3px;}
.back-btn{padding:7px 16px;border-radius:20px;border:1.5px solid rgba(255,255,255,.6);color:#fff;font-size:12px;text-decoration:none;white-space:nowrap;}
.back-btn:hover{background:rgba(255,255,255,.15);}
.wrap{max-width:1400px;margin:0 auto;padding:18px 16px;}
.tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;}
.tab-btn{padding:8px 20px;border-radius:20px;border:2px solid #ddd;background:#fff;font-size:13px;font-weight:600;cursor:pointer;transition:.15s;}
.tab-btn.active{background:#40916c;color:#fff;border-color:#40916c;}
.controls{background:#fff;border-radius:12px;padding:12px 16px;box-shadow:0 2px 8px rgba(0,0,0,.07);margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;}
.controls select,.controls input[type=text]{padding:7px 10px;border-radius:8px;border:1.5px solid #ddd;font-size:13px;cursor:pointer;background:#fff;}
.controls select:focus,.controls input:focus{outline:none;border-color:#40916c;}
.dl-btn{padding:7px 14px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;}
.dl-csv{background:#e8f5e9;color:#1b4332;}
.dl-xlsx{background:#e3f2fd;color:#1565c0;}
.dl-btn:hover{filter:brightness(.94);}
.count-badge{margin-left:auto;font-size:12px;color:#888;}
.table-wrap{background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);overflow:auto;max-height:68vh;}
table{width:100%;border-collapse:collapse;font-size:12px;white-space:nowrap;}
th{background:#f0f7f4;padding:8px 10px;text-align:left;font-size:11px;color:#444;border-bottom:2px solid #dde9e5;position:sticky;top:0;z-index:1;}
td{padding:7px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle;}
tr:hover td{background:#f9fdf9;}
.tag{display:inline-block;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600;}
.t-otuk{background:#ff6b35;color:#fff;}
.t-yes{background:#e8f5e9;color:#2e7d32;}
.t-no{background:#f5f5f5;color:#bbb;}
.no-data{padding:40px;text-align:center;color:#bbb;font-size:13px;}
@media(max-width:768px){.controls{flex-direction:column;align-items:stretch;}}
</style>
</head>
<body>
<header>
  <div>
    <h1>📦 Raw 데이터 다운로드</h1>
    <p>기준: ${latestDate} &nbsp;|&nbsp; 스냅샷 ${snapCountLabel}행 &nbsp;|&nbsp; 변동 ${chgCountLabel}행</p>
  </div>
  <a href="index.html" class="back-btn">← 대시보드</a>
</header>

<div class="wrap">
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('snapshots',this)">📋 Raw Snapshots (${snapCountLabel}행)</button>
    <button class="tab-btn" onclick="switchTab('changes',this)">📈 Daily Changes (${chgCountLabel}행)</button>
    <button class="tab-btn" onclick="switchTab('otuk',this)">🔥 오특 상품만</button>
  </div>

  <div class="controls" id="ctrl-snapshots">
    <select id="snap-date" onchange="renderTable()"><option value="">모든 날짜</option>${dateOptions}</select>
    <select id="snap-cat" onchange="renderTable()"><option value="">모든 카테고리</option>${catOptions}</select>
    <input id="snap-q" type="text" placeholder="브랜드 / 상품명 검색..." oninput="renderTable()" style="min-width:180px;">
    <span class="count-badge" id="snap-count"></span>
    <button class="dl-btn dl-csv" onclick="downloadCSV('snapshots')">📥 CSV</button>
    <button class="dl-btn dl-xlsx" onclick="downloadExcel('snapshots')">📊 Excel</button>
  </div>
  <div class="controls" id="ctrl-changes" style="display:none;">
    <select id="chg-date" onchange="renderTable()"><option value="">모든 날짜</option>${dateOptions}</select>
    <input id="chg-q" type="text" placeholder="브랜드 검색..." oninput="renderTable()" style="min-width:180px;">
    <span class="count-badge" id="chg-count"></span>
    <button class="dl-btn dl-csv" onclick="downloadCSV('changes')">📥 CSV</button>
    <button class="dl-btn dl-xlsx" onclick="downloadExcel('changes')">📊 Excel</button>
  </div>
  <div class="controls" id="ctrl-otuk" style="display:none;">
    <select id="otuk-cat" onchange="renderTable()"><option value="">모든 카테고리</option>${catOptions}</select>
    <span class="count-badge" id="otuk-count"></span>
    <button class="dl-btn dl-csv" onclick="downloadCSV('otuk')">📥 CSV</button>
    <button class="dl-btn dl-xlsx" onclick="downloadExcel('otuk')">📊 Excel</button>
  </div>

  <div class="table-wrap" id="table-area"><p class="no-data">로딩 중...</p></div>
</div>

<script>
const SNAPS   = ${JSON.stringify(snaps)};
const CHANGES = ${JSON.stringify(changes)};
const CAT_LABELS = { skincare:'스킨케어', bodycare:'바디케어' };

const SNAP_COLS = [
  {k:'snapshot_date',l:'날짜'},{k:'category',l:'카테고리'},{k:'rank',l:'순위'},
  {k:'brand_name_raw',l:'브랜드'},{k:'product_name_raw',l:'상품명'},
  {k:'list_price',l:'정가'},{k:'sale_price',l:'판매가'},
  {k:'price_discount_amount',l:'할인액'},{k:'price_discount_rate',l:'할인율'},
  {k:'badges',l:'배지'},{k:'has_otuk',l:'오특여부'},{k:'is_sold_out',l:'품절'},
  {k:'product_url',l:'상품URL'},
];
const CHG_COLS = [
  {k:'snapshot_date',l:'날짜'},{k:'brand_key',l:'브랜드키'},
  {k:'today_rank',l:'오늘순위'},{k:'yesterday_rank',l:'전일순위'},{k:'rank_change',l:'순위변동'},
  {k:'today_sale_price',l:'오늘가격'},{k:'yesterday_sale_price',l:'전일가격'},
  {k:'price_change',l:'변동액'},{k:'price_change_rate',l:'변동률'},
  {k:'is_new_entry',l:'신규진입'},{k:'is_reentry',l:'재진입'},{k:'is_price_changed',l:'가격변동'},
];

let currentTab = 'snapshots';

function switchTab(tab, btn) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('ctrl-snapshots').style.display = tab==='snapshots' ? '' : 'none';
  document.getElementById('ctrl-changes').style.display   = tab==='changes'   ? '' : 'none';
  document.getElementById('ctrl-otuk').style.display      = tab==='otuk'      ? '' : 'none';
  renderTable();
}

function boolVal(v) { return v === true || v === 'true'; }

function getFiltered() {
  if (currentTab === 'snapshots') {
    const date = document.getElementById('snap-date').value;
    const cat  = document.getElementById('snap-cat').value;
    const q    = document.getElementById('snap-q').value.toLowerCase();
    return SNAPS.filter(r =>
      (!date || r.snapshot_date === date) &&
      (!cat  || r.category === cat) &&
      (!q    || (r.brand_name_raw||'').toLowerCase().includes(q) || (r.product_name_raw||'').toLowerCase().includes(q))
    );
  } else if (currentTab === 'changes') {
    const date = document.getElementById('chg-date').value;
    const q    = document.getElementById('chg-q').value.toLowerCase();
    return CHANGES.filter(r =>
      (!date || r.snapshot_date === date) &&
      (!q    || (r.brand_key||'').toLowerCase().includes(q))
    );
  } else {
    const cat = document.getElementById('otuk-cat').value;
    return SNAPS.filter(r =>
      boolVal(r.has_otuk) && (!cat || r.category === cat)
    ).sort((a,b) => a.snapshot_date < b.snapshot_date ? 1 : a.snapshot_date > b.snapshot_date ? -1 : +a.rank - +b.rank);
  }
}

function getCols() { return currentTab === 'changes' ? CHG_COLS : SNAP_COLS; }

function fmtCell(k, v) {
  if (v === null || v === undefined) return '—';
  const boolKeys = ['has_otuk','is_sold_out','is_new_entry','is_reentry','is_price_changed'];
  if (boolKeys.includes(k)) {
    const yes = boolVal(v);
    if (k==='has_otuk' && yes) return '<span class="tag t-otuk">오특</span>';
    return '<span class="tag '+(yes?'t-yes':'t-no')+'">'+(yes?'예':'—')+'</span>';
  }
  if (['sale_price','list_price','today_sale_price','yesterday_sale_price'].includes(k))
    return v ? (+v).toLocaleString()+'원' : '—';
  if (['price_discount_rate','price_change_rate'].includes(k))
    return v ? Math.round(+v*100)+'%' : '—';
  if (['price_change','price_discount_amount'].includes(k)) {
    if (!v && v!==0) return '—';
    const n=+v; return (n>0?'+':'')+n.toLocaleString()+'원';
  }
  if (k==='rank_change') {
    if (v===null||v==='') return '—';
    const n=+v;
    const col=n>0?'style="color:#e74c3c;font-weight:700"':n<0?'style="color:#3498db;font-weight:700"':'';
    return '<span '+col+'>'+(n>0?'▲':n<0?'▼':'—')+' '+Math.abs(n)+'</span>';
  }
  if (k==='product_url') return v?'<a href="'+v+'" target="_blank" style="color:#40916c;">링크</a>':'—';
  if (k==='category') return CAT_LABELS[v]||v;
  return String(v);
}

function renderTable() {
  const rows = getFiltered();
  const cols = getCols();
  const countId = {snapshots:'snap-count',changes:'chg-count',otuk:'otuk-count'}[currentTab];
  document.getElementById(countId).textContent = rows.length.toLocaleString()+'행';

  if (rows.length === 0) {
    document.getElementById('table-area').innerHTML = '<p class="no-data">데이터가 없습니다.</p>';
    return;
  }
  const thead = '<thead><tr>'+cols.map(c=>'<th>'+c.l+'</th>').join('')+'</tr></thead>';
  const tbody = '<tbody>'+rows.map(r=>
    '<tr>'+cols.map(c=>'<td>'+fmtCell(c.k,r[c.k])+'</td>').join('')+'</tr>'
  ).join('')+'</tbody>';
  document.getElementById('table-area').innerHTML = '<table>'+thead+tbody+'</table>';
}

function toCSVStr(rows, cols) {
  const h = cols.map(c=>'"'+c.l+'"').join(',');
  const b = rows.map(r=>cols.map(c=>{
    const v=r[c.k]; if(v===null||v===undefined) return '';
    return '"'+String(v).replace(/"/g,'""')+'"';
  }).join(',')).join('\\n');
  return h+'\\n'+b;
}

function downloadCSV(tab) {
  const old = currentTab; currentTab = tab;
  const rows = getFiltered(); currentTab = old;
  const cols = tab==='changes' ? CHG_COLS : SNAP_COLS;
  const csv  = toCSVStr(rows, cols);
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'),{href:url,download:'oliveyoung_'+tab+'_'+new Date().toISOString().slice(0,10)+'.csv'});
  a.click(); URL.revokeObjectURL(url);
}

function downloadExcel(tab) {
  const old = currentTab; currentTab = tab;
  const rows = getFiltered(); currentTab = old;
  const cols = tab==='changes' ? CHG_COLS : SNAP_COLS;
  const data = [cols.map(c=>c.l)].concat(rows.map(r=>cols.map(c=>{
    const v=r[c.k];
    if(v===null||v===undefined) return '';
    if(typeof v==='boolean') return v?'예':'아니오';
    return v;
  })));
  const ws = XLSX.utils.aoa_to_sheet(data);
  // 컬럼 너비 자동 설정
  ws['!cols'] = cols.map(c=>({wch: Math.max(c.l.length*2, 12)}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tab);
  XLSX.writeFile(wb, 'oliveyoung_'+tab+'_'+new Date().toISOString().slice(0,10)+'.xlsx');
}

renderTable();
<\/script>
</body>
</html>`;
}

module.exports = { generateReport };

if (require.main === module) {
  generateReport().catch(err => { console.error(err.message); process.exit(1); });
}
