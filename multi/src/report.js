// 무신사 · 올리브영 글로벌 랭킹 대시보드 페이지 생성
// rk_snapshots 를 읽어 플랫폼별 정적 HTML(musinsa.html / global.html)을 만든다.
// 국내 대시보드(src/report.js)와 같은 디자인·구성을 따르되, 기존 파일/테이블은 건드리지 않는다.
//
//   node src/report.js                       # Supabase 에서 읽어 site/ 에 생성
//   node src/report.js --out=../site          # 출력 폴더 지정
//   node src/report.js --from-json=rows.json  # (로컬 미리보기) DB 대신 JSON 배열 사용
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const OUT_DIR = path.resolve(args.out || process.env.MULTI_PAGES_DIR || 'site');

// ── 플랫폼 정의 ────────────────────────────────────────────────────────────
const PLATFORMS = [
  {
    key: 'musinsa', file: 'musinsa.html', icon: '🛒', name: '무신사 뷰티 랭킹', short: '무신사',
    sub: '일간 판매 랭킹 TOP100',
    cats: [['skincare', '스킨케어'], ['mask', '마스크팩'], ['cleanser', '클렌징/필링']],
    lang: 'ko',
  },
  {
    key: 'oy_global', file: 'global.html', icon: '🌏', name: '올리브영 글로벌 랭킹', short: '글로벌',
    sub: 'Best Seller · Top Orders TOP100 (USD)',
    cats: [['skincare', '스킨케어'], ['body', '바디'], ['mask', '마스크팩']],
    lang: 'en',
  },
];
const NAV = [
  { href: 'index.html', label: '🇰🇷 국내 올리브영' },
  ...PLATFORMS.map(p => ({ href: p.file, label: `${p.icon} ${p.short}`, key: p.key })),
];

// ── 키워드 사전 (상품명 부분일치) ──────────────────────────────────────────
const KW_LEX = {
  ko: {
    '제품': ['토너','스킨','세럼','앰플','크림','로션','에센스','미스트','오일','밤','클렌징','폼','클렌저','젤',
      '스크럽','필링','마스크','팩','패드','선크림','선스틱','선세럼','선쿠션','쿠션','패치','워터','리무버','버블','파우더'],
    '성분': ['PDRN','시카','콜라겐','히알루론','레티놀','나이아신아마이드','세라마이드','판테놀','어성초','병풀','마데카',
      '펩타이드','비타민','살리실산','스쿠알란','티트리','녹차','프로폴리스','달팽이','쑥','알로에','아데노신',
      '프로바이오','쌀','캐모마일','자작나무','아줄렌','바쿠치올','글루타치온','엑소좀'],
    '효능': ['진정','수분','보습','모공','미백','주름','탄력','리페어','쿨링','각질','트러블','재생','톤업','영양',
      '민감','저자극','약산성','흔적','홍조','촉촉','딥클렌징','광채','글로우','리프팅','브라이트닝','장벽','피지','블랙헤드'],
    '마케팅': ['기획','한정','대용량','증정','단독','1+1','세트','에디션','리필','더블','듀오','특가','NEW','콜라보',
      '패키지','미니','키트','증량','무신사','신상','리뉴얼','선물','베스트'],
  },
  en: {
    '제품': ['toner','serum','ampoule','cream','lotion','essence','mist','oil','balm','cleanser','foam','gel','scrub',
      'peeling','mask','sheet','pad','sunscreen','sun stick','sun cream','cushion','patch','body wash','body lotion',
      'shampoo','lip','powder','water'],
    '성분': ['pdrn','centella','cica','collagen','hyaluronic','retinol','niacinamide','ceramide','panthenol','heartleaf',
      'mugwort','snail','propolis','rice','peptide','vitamin','salicylic','tea tree','green tea','madeca','probiotic',
      'birch','aloe','bakuchiol','azulene','glutathione','exosome','houttuynia','ginseng'],
    '효능': ['hydrat*','moistur*','sooth*','calm*','pore*','bright*','whiten*','anti-aging','wrinkle*','firm*','lifting','glow*',
      'exfoliat*','acne','blemish','barrier','repair*','sensitive','gentle','deep clean*','sebum','tone-up','tone up','dewy','cooling'],
    '마케팅': ['set','duo','special','limited','edition','value','jumbo','big size','mini','refill','bundle','1+1',
      'gift','collab','new','best','kit','double','trio'],
  },
};
const KW_TYPES = ['제품', '성분', '효능', '마케팅'];

// 키워드 → 매처. 한국어는 부분일치(국내 대시보드와 동일),
// 영어는 단어 경계 일치('tone'이 'toner'에 걸리지 않게). 끝에 * 가 붙은 건 어간 일치(hydrat* → hydrating, hydration).
function makeMatcher(lang, word) {
  const stem = word.endsWith('*');
  const w = word.replace(/\*$/, '').toLowerCase();
  if (lang !== 'en') return { label: w, test: n => n.includes(w) };
  const re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (stem ? '' : '(?![a-z0-9])'));
  return { label: w, test: n => re.test(n) };
}

// ── 데이터 읽기 ─────────────────────────────────────────────────────────────
const COLS = 'snapshot_date,platform,category,rank,product_id,brand_name,product_name,currency,list_price,sale_price,discount_rate,rating,review_count,badges';

async function fetchPlatformRows(platform) {
  const { db } = require('./lib/db');
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from('rk_snapshots').select(COLS)
      .eq('platform', platform)
      .order('snapshot_date').order('category').order('rank')
      .range(from, from + 999);
    if (error) throw new Error(`rk_snapshots 조회 실패: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ── 유틸 ────────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = v => JSON.stringify(v).replace(/</g, '\\u003c');   // <script> 안에 안전하게 삽입
const normBrand = b => (b || '').replace(/\s+/g, '').toLowerCase();

// ── 집계 ────────────────────────────────────────────────────────────────────
function aggregate(P, rows) {
  const categories = P.cats.map(c => c[0]).filter(c => rows.some(r => r.category === c));
  const catLabels = Object.fromEntries(P.cats);
  const allDates = [...new Set(rows.map(r => r.snapshot_date))].sort();
  const latestDate = allDates[allDates.length - 1];
  const currency = rows.find(r => r.currency)?.currency || 'KRW';

  // 카테고리 × 날짜 → 순위순 목록
  const byCatDate = {};
  categories.forEach(c => { byCatDate[c] = {}; });
  rows.forEach(r => {
    if (!byCatDate[r.category]) return;
    (byCatDate[r.category][r.snapshot_date] ||= []).push(r);
  });
  Object.values(byCatDate).forEach(m => Object.values(m).forEach(a => a.sort((x, y) => x.rank - y.rank)));

  // 카테고리별: 최신일 / 직전 수집일 / 오늘 변동
  const catInfo = {};
  categories.forEach(cat => {
    const dates = Object.keys(byCatDate[cat]).sort();
    const today = dates[dates.length - 1];
    const prev = dates[dates.length - 2] || null;
    const prevRank = new Map((prev ? byCatDate[cat][prev] : []).map(p => [p.product_id, p.rank]));
    const seenBefore = new Set();
    dates.slice(0, -1).forEach(d => byCatDate[cat][d].forEach(p => seenBefore.add(p.product_id)));
    const todayIds = new Set();

    const items = (byCatDate[cat][today] || []).map(p => {
      todayIds.add(p.product_id);
      const pr = prevRank.get(p.product_id);
      return {
        ...p,
        prev_rank: pr ?? null,
        rank_change: pr != null ? pr - p.rank : null,
        status: !prev ? '' : pr != null ? '' : seenBefore.has(p.product_id) ? 'RE' : 'NEW',
      };
    });
    const exits = (prev ? byCatDate[cat][prev] : []).filter(p => !todayIds.has(p.product_id));

    // 오늘 TOP100 브랜드 점유 (상품 수)
    const share = {};
    items.forEach(p => {
      const k = normBrand(p.brand_name);
      if (!k) return;
      (share[k] ||= { name: p.brand_name, count: 0, best: p.rank }).count++;
    });

    catInfo[cat] = {
      today, prev, dates, items, exits,
      risers: items.filter(p => p.rank_change > 0).sort((a, b) => b.rank_change - a.rank_change).slice(0, 10),
      newcomers: items.filter(p => p.status).slice(0, 15),
      brandShare: Object.values(share).sort((a, b) => b.count - a.count || a.best - b.best).slice(0, 10),
    };
  });

  // 브랜드 히스토리: 날짜별 최고 순위·가격·TOP100 상품 수
  const brandHistory = {};
  categories.forEach(cat => {
    brandHistory[cat] = {};
    Object.entries(byCatDate[cat]).forEach(([d, list]) => list.forEach(p => {
      if (!p.brand_name) return;
      const h = (brandHistory[cat][p.brand_name] ||= {});
      const cur = h[d];
      if (!cur) h[d] = { rank: p.rank, price: p.sale_price != null ? +p.sale_price : null, n: 1 };
      else {
        cur.n++;
        if (p.rank < cur.rank) { cur.rank = p.rank; cur.price = p.sale_price != null ? +p.sale_price : cur.price; }
      }
    }));
  });

  // 상품별 날짜 데이터 (키워드 검색·기간 슬라이서용)
  const productMap = {};
  rows.forEach(r => {
    if (!byCatDate[r.category]) return;
    const k = r.category + '|' + r.product_id;
    const e = (productMap[k] ||= { c: r.category, b: r.brand_name, n: r.product_name, id: r.product_id, d: {} });
    e.n = r.product_name || e.n;
    e.d[r.snapshot_date] = [r.rank, r.sale_price != null ? +r.sale_price : null];
  });
  const products = Object.values(productMap);

  // 키워드 인사이트: 월 × 카테고리 × 유형, 해당 월 등장 고유 상품 중 키워드 포함 상품 수
  const lex = Object.fromEntries(KW_TYPES.map(t => [t, KW_LEX[P.lang][t].map(w => makeMatcher(P.lang, w))]));
  const months = [...new Set(allDates.map(d => d.slice(0, 7)))].sort();
  const keywordByMonth = {};
  months.forEach(m => {
    keywordByMonth[m] = {};
    categories.forEach(cat => {
      const names = new Set();
      Object.entries(byCatDate[cat]).forEach(([d, list]) => {
        if (d.slice(0, 7) === m) list.forEach(p => p.product_name && names.add(p.product_name.toLowerCase()));
      });
      const arr = [...names];
      keywordByMonth[m][cat] = Object.fromEntries(KW_TYPES.map(t => [t, lex[t]
        .map(m => ({ w: m.label, n: arr.filter(m.test).length }))
        .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 8)]));
    });
  });

  return { categories, catLabels, allDates, latestDate, currency, byCatDate, catInfo, brandHistory, products, keywordByMonth, months };
}

// ── HTML ────────────────────────────────────────────────────────────────────
function buildHtml(P, A) {
  const { categories, catLabels, allDates, latestDate, currency, catInfo, brandHistory, products, keywordByMonth, months } = A;
  const fmtPrice = v => v == null ? '-' : currency === 'USD' ? '$' + (+v).toFixed(2) : Math.round(+v).toLocaleString('ko-KR') + '원';
  const rankBadge = r => `<span class="rb ${r === 1 ? 'r1' : r === 2 ? 'r2' : r === 3 ? 'r3' : 'rn'}">${r}</span>`;
  const changeCell = p => p.status === 'NEW' ? '<span class="tag t-first">NEW</span>'
    : p.status === 'RE' ? '<span class="tag t-other">재진입</span>'
    : p.rank_change > 0 ? `<span class="up">▲${p.rank_change}</span>`
    : p.rank_change < 0 ? `<span class="dn">▼${-p.rank_change}</span>` : '<span style="color:#bbb;">-</span>';
  const badgeTags = b => (Array.isArray(b) ? b : []).slice(0, 4).map(x => `<span class="tag t-other">${esc(x)}</span>`).join('');
  const brandLink = (cat, b) => b ? `<a href="#" class="brand-link" data-cat="${cat}" data-brand="${esc(b)}" onclick="selectBrand(this.dataset.cat,this.dataset.brand);return false;">${esc(b)}</a>` : '-';
  const rating = p => p.rating != null ? `★${(+p.rating).toFixed(1)}${p.review_count != null ? ` <span style="color:#999;">(${(+p.review_count).toLocaleString()})</span>` : ''}` : '-';
  const kwMonthLatest = months[months.length - 1] || '';
  const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#F7DC6F', '#DDA0DD', '#98D8C8', '#BB8FCE', '#85C1E9', '#FFEAA7'];

  // TOP10 브랜드 순위 추이 (최근 14 수집일)
  const rankCharts = {};
  categories.forEach(cat => {
    const recent = catInfo[cat].dates.slice(-14);
    const brands = [...new Set(catInfo[cat].items.slice(0, 10).map(p => p.brand_name).filter(Boolean))];
    rankCharts[cat] = {
      labels: recent,
      datasets: brands.map((b, i) => ({
        label: b, data: recent.map(d => brandHistory[cat][b]?.[d]?.rank ?? null),
        borderColor: colors[i % colors.length], backgroundColor: colors[i % colors.length] + '33',
        tension: 0.3, spanGaps: true, pointRadius: 3,
      })),
    };
  });

  const brandNamesByCat = Object.fromEntries(categories.map(c => [c, Object.keys(brandHistory[c]).sort((a, b) => a.localeCompare(b, 'ko'))]));
  const todayByCat = Object.fromEntries(categories.map(c => [c, catInfo[c].items.map(p => ({
    r: p.rank, b: p.brand_name, n: p.product_name, lp: p.list_price, sp: p.sale_price, dr: p.discount_rate,
    rt: p.rating, rv: p.review_count,
  }))]));

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(P.name)} 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Apple SD Gothic Neo','Noto Sans KR',sans-serif;background:#f4f6f9;color:#333;}
header{background:linear-gradient(135deg,#1b4332,#40916c);color:#fff;padding:20px 28px;}
header h1{font-size:20px;font-weight:700;}
header p{font-size:12px;opacity:.8;margin-top:3px;}
.nav{display:flex;gap:8px;flex-wrap:wrap;}
.nav a{padding:7px 16px;border-radius:20px;border:1.5px solid rgba(255,255,255,.6);color:#fff;font-size:12px;text-decoration:none;white-space:nowrap;}
.nav a.on{background:#fff;color:#1b4332;font-weight:700;border-color:#fff;}
.wrap{max-width:1280px;margin:0 auto;padding:20px 16px;}
.cat-tabs{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;}
.cat-tab{padding:8px 22px;border-radius:20px;border:2px solid #ddd;background:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:.2s;}
.cat-tab.active{background:#40916c;color:#fff;border-color:#40916c;}
.cat-tab:hover:not(.active){border-color:#40916c;color:#40916c;}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.07);margin-bottom:18px;}
.card h2{font-size:14px;font-weight:700;color:#1b4332;margin-bottom:14px;}
.card h2 .sub{font-weight:400;font-size:12px;color:#888;}
tr.rank-rest{display:none;}
body.show-rest tr.rank-rest{display:table-row;}
.kw-month-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 2px 8px rgba(0,0,0,.07);margin-bottom:18px;font-weight:700;color:#1b4332;font-size:14px;}
.kw-month-bar select{padding:6px 12px;border-radius:8px;border:1.5px solid #b7e4c7;background:#f6fbf8;font-size:13px;font-weight:600;color:#1b4332;cursor:pointer;}
.kw-month-bar .kw-hint{font-weight:400;font-size:12px;color:#888;margin-left:auto;}
.kw-types{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
@media(max-width:700px){.kw-types{grid-template-columns:1fr 1fr;}}
.kw-type-h{font-size:12px;font-weight:800;padding-bottom:5px;margin-bottom:9px;border-bottom:2px solid;}
.kw-t-prod{color:#2d6a4f;border-color:#95d5b2;}.kw-t-ingr{color:#1565c0;border-color:#90caf9;}
.kw-t-effi{color:#c2185b;border-color:#f48fb1;}.kw-t-mkt{color:#e65100;border-color:#ffcc80;}
.kw-chip{display:inline-block;background:#f4f6f9;border-radius:14px;padding:4px 10px;margin:0 5px 6px 0;font-size:12px;color:#333;}
.kw-chip b{margin-left:5px;color:#40916c;font-weight:700;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{background:#f0f7f4;padding:7px 10px;text-align:left;font-size:12px;color:#555;border-bottom:2px solid #dde9e5;white-space:nowrap;}
td{padding:7px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle;}
td:first-child{white-space:nowrap;}
tr:last-child td{border-bottom:none;}
tr:hover td{background:#f9fdf9;}
.rb{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:700;}
.r1{background:#FFD700;color:#333;}.r2{background:#C0C0C0;color:#333;}.r3{background:#CD7F32;color:#fff;}.rn{background:#e8f5e9;color:#1b4332;}
.up{color:#e74c3c;font-weight:700;}.dn{color:#3498db;font-weight:700;}
.tag{display:inline-block;padding:1px 6px;border-radius:8px;font-size:11px;margin:1px;white-space:nowrap;}
.t-other{background:#e8eaf6;color:#3949ab;}.t-first{background:#e3f2fd;color:#1565c0;font-weight:700;}
.pname{max-width:260px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.pname a{color:#333;text-decoration:none;}.pname a:hover{text-decoration:underline;}
.brand-link{color:#1b4332;font-weight:600;text-decoration:none;}
.share-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;}
.share-row .nm{width:110px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600;}
.share-row .bar{flex:1;background:#f0f0f0;border-radius:6px;height:12px;overflow:hidden;}
.share-row .bar i{display:block;height:100%;background:#40916c;border-radius:6px;}
.share-row .ct{width:34px;text-align:right;color:#555;}
.brand-select-area{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;}
.brand-select-area select{padding:8px 12px;border-radius:8px;border:1.5px solid #ddd;font-size:13px;min-width:200px;cursor:pointer;}
.brand-detail{display:none;}.brand-detail.show{display:block;}
.chart-wrap{height:260px;position:relative;}.chart-wrap2{height:220px;position:relative;}
.no-data{color:#aaa;font-size:13px;padding:30px 0;text-align:center;}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
#keyword-search-section{display:none;}
.kw-input-wrap{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;}
.kw-input-wrap input[type=text]{flex:1;min-width:200px;padding:10px 16px;border-radius:24px;border:2px solid #40916c;font-size:15px;outline:none;}
.kw-result-meta{font-size:12px;color:#888;white-space:nowrap;}
.kw-slicer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#f8fdf9;border:1px solid #d4edda;border-radius:10px;padding:10px 14px;margin-bottom:16px;}
.kw-slicer-label{font-size:12px;font-weight:700;color:#555;margin-right:4px;}
.kw-period{padding:5px 14px;border-radius:16px;border:1.5px solid #ccc;background:#fff;font-size:12px;font-weight:600;cursor:pointer;}
.kw-period.active{background:#40916c;color:#fff;border-color:#40916c;}
.kw-date-range{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.kw-date-range input[type=date]{padding:4px 8px;border-radius:8px;border:1.5px solid #ddd;font-size:12px;}
.kw-tag{display:inline-block;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;background:#e8f5e9;color:#1b4332;white-space:nowrap;}
.kw-empty{color:#bbb;font-size:14px;text-align:center;padding:40px 0;}
@media(max-width:768px){
  header{padding:12px 14px;}header h1{font-size:17px;}
  .wrap{padding:12px 10px;}
  .grid2,.grid3{grid-template-columns:1fr;}
  .cat-tabs{position:sticky;top:0;z-index:100;background:#f4f6f9;overflow-x:auto;flex-wrap:nowrap;padding:8px 10px;margin:0 -10px 14px;border-bottom:1px solid #e0e0e0;}
  .cat-tab{white-space:nowrap;padding:7px 14px;font-size:13px;}
  .card{padding:12px;border-radius:10px;margin-bottom:12px;}
  table{font-size:12px;}th,td{padding:5px 7px;}
  .pname{max-width:150px;}
  .brand-select-area{flex-direction:column;align-items:stretch;}
  .brand-select-area select{min-width:0;width:100%;}
  .chart-wrap{height:190px;}.chart-wrap2{height:150px;}
}
</style>
</head>
<body>
<header style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
  <div>
    <h1>${P.icon} ${esc(P.name)} 대시보드</h1>
    <p>${esc(P.sub)} &nbsp;|&nbsp; 기준: ${latestDate} &nbsp;|&nbsp; 수집일: ${allDates.length}일 &nbsp;|&nbsp; 카테고리: ${categories.map(c => catLabels[c]).join(', ')}</p>
  </div>
  <nav class="nav">${NAV.map(n => `<a href="${n.href}"${n.key === P.key ? ' class="on"' : ''}>${n.label}</a>`).join('')}</nav>
</header>

<div class="wrap">
  <div class="cat-tabs">
    <button class="cat-tab active" onclick="switchCat('all',this)">📊 전체</button>
    ${categories.map(c => `<button class="cat-tab" onclick="switchCat('${c}',this)">${catLabels[c]}</button>`).join('')}
    <button class="cat-tab" onclick="switchCat('keyword',this)">🔍 키워드 검색</button>
  </div>

  <div id="kw-month-bar" class="kw-month-bar">
    <span>🔤 키워드 인사이트 &nbsp;·&nbsp; 📅 기간</span>
    <select id="kw-month-sel" onchange="renderKeywords(this.value)">
      ${months.slice().reverse().map(m => `<option value="${m}"${m === kwMonthLatest ? ' selected' : ''}>${m.slice(0, 4)}년 ${+m.slice(5)}월</option>`).join('')}
    </select>
    <span class="kw-hint">상품명 언급 빈도(해당 월 등장 상품 수)</span>
  </div>

  ${categories.map(cat => `<div class="card cat-section kw-card" data-cat="${cat}">
    <h2>🔤 ${catLabels[cat]} 키워드 인사이트</h2>
    <div class="kw-types" id="kwtypes-${cat}"></div>
  </div>`).join('')}

  ${categories.map(cat => {
    const I = catInfo[cat];
    return `<div class="cat-section" data-cat="${cat}">
    <div class="card">
      <h2>🏆 ${catLabels[cat]} 오늘 TOP <span class="top-n">10</span> <span class="sub">${I.today}${I.prev ? ` · 변동은 직전 수집일(${I.prev}) 대비` : ''}</span></h2>
      <div class="tbl-wrap"><table><thead><tr><th>#</th><th>변동</th><th>브랜드</th><th>상품명</th><th>판매가</th><th>할인</th><th>평점(리뷰)</th><th>배지</th></tr></thead><tbody>
      ${I.items.map(p => `<tr class="${p.rank > 10 ? 'rank-rest' : ''}">
        <td>${rankBadge(p.rank)}</td>
        <td>${changeCell(p)}</td>
        <td>${brandLink(cat, p.brand_name)}</td>
        <td class="pname" title="${esc(p.product_name)}">${esc(p.product_name)}</td>
        <td style="white-space:nowrap;">${fmtPrice(p.sale_price)}</td>
        <td>${p.discount_rate ? Math.round(p.discount_rate * 100) + '%' : '-'}</td>
        <td style="white-space:nowrap;">${rating(p)}</td>
        <td>${badgeTags(p.badges)}</td>
      </tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="grid3 cat-only" data-cat="${cat}">
      <div class="card">
        <h2>🚀 순위 급상승</h2>
        ${I.risers.length === 0 ? '<p class="no-data">직전 수집일 대비 상승한 상품이 없어요.</p>' : `<div class="tbl-wrap"><table><thead><tr><th>순위</th><th>변동</th><th>브랜드 · 상품</th></tr></thead><tbody>
        ${I.risers.map(p => `<tr><td>${p.rank}위</td><td><span class="up">▲${p.rank_change}</span></td><td class="pname" title="${esc(p.product_name)}"><b>${esc(p.brand_name)}</b> ${esc(p.product_name)}</td></tr>`).join('')}
        </tbody></table></div>`}
      </div>
      <div class="card">
        <h2>✨ 신규 진입 · 재진입</h2>
        ${I.newcomers.length === 0 ? '<p class="no-data">오늘 새로 들어온 상품이 없어요.</p>' : `<div class="tbl-wrap"><table><thead><tr><th>순위</th><th></th><th>브랜드 · 상품</th></tr></thead><tbody>
        ${I.newcomers.map(p => `<tr><td>${p.rank}위</td><td>${changeCell(p)}</td><td class="pname" title="${esc(p.product_name)}"><b>${esc(p.brand_name)}</b> ${esc(p.product_name)}</td></tr>`).join('')}
        </tbody></table></div>`}
        ${I.exits.length ? (() => { const bs = [...new Set(I.exits.map(p => p.brand_name).filter(Boolean))]; return `<p style="font-size:12px;color:#999;margin-top:8px;">이탈 ${I.exits.length}개 · ${bs.slice(0, 6).map(esc).join(', ')}${bs.length > 6 ? ' …' : ''}</p>`; })() : ''}
      </div>
      <div class="card">
        <h2>🏷️ 브랜드 점유 <span class="sub">TOP100 내 상품 수</span></h2>
        ${I.brandShare.map(b => `<div class="share-row"><span class="nm" title="${esc(b.name)}">${esc(b.name)}</span><span class="bar"><i style="width:${Math.min(100, b.count / I.brandShare[0].count * 100)}%"></i></span><span class="ct">${b.count}개</span></div>`).join('')}
      </div>
    </div>
    </div>`;
  }).join('')}

  ${categories.map(cat => `<div class="card cat-section cat-only" data-cat="${cat}">
    <h2>📈 ${catLabels[cat]} TOP10 브랜드 순위 추이 <span class="sub">최근 ${rankCharts[cat].labels.length}회 수집 · 브랜드별 최고 순위</span></h2>
    ${rankCharts[cat].labels.length < 2 ? '<p class="no-data">데이터가 2일 이상 쌓이면 차트가 표시됩니다.</p>' : `<div class="chart-wrap"><canvas id="rankChart-${cat}"></canvas></div>`}
  </div>`).join('')}

  <div id="keyword-search-section">
    <div class="card">
      <h2>🔍 키워드 검색</h2>
      <p style="font-size:12px;color:#888;margin-bottom:14px;">제품명 또는 브랜드명으로 검색 · 기간을 선택하면 해당 구간 통계로 재계산됩니다.</p>
      <div class="kw-input-wrap">
        <input id="kw-input" type="text" placeholder="${P.lang === 'en' ? '예: serum, sunscreen, anua' : '예: 앰플, 선크림, 토리든'}" oninput="kwSearch()">
        <span class="kw-result-meta" id="kw-meta"></span>
      </div>
      <div class="kw-slicer">
        <span class="kw-slicer-label">기간</span>
        <button class="kw-period active" onclick="kwSetPeriod(0,this)">전체</button>
        <button class="kw-period" onclick="kwSetPeriod(7,this)">7일</button>
        <button class="kw-period" onclick="kwSetPeriod(14,this)">14일</button>
        <button class="kw-period" onclick="kwSetPeriod(30,this)">30일</button>
        <div class="kw-date-range">
          <span class="kw-slicer-label">직접 선택</span>
          <input type="date" id="kw-from" onchange="kwSetCustom()"> ~ <input type="date" id="kw-to" onchange="kwSetCustom()">
        </div>
      </div>
      <div id="kw-results"><p class="kw-empty">검색어를 입력하면 결과가 표시됩니다.</p></div>
    </div>
  </div>

  <div class="card" id="brand-analysis-card">
    <h2>🔍 브랜드별 상세 분석</h2>
    <div class="brand-select-area">
      <span style="font-size:13px;font-weight:600;color:#555;">카테고리</span>
      <select id="brand-cat-sel" onchange="refreshBrandList()">
        ${categories.map(c => `<option value="${c}">${catLabels[c]}</option>`).join('')}
      </select>
      <span style="font-size:13px;font-weight:600;color:#555;">브랜드</span>
      <select id="brand-sel" onchange="showBrandDetail()"><option value="">-- 브랜드를 선택하세요 --</option></select>
    </div>
    <div id="brand-detail" class="brand-detail">
      <div class="grid2" style="margin-bottom:14px;">
        <div><p style="font-size:12px;color:#666;margin-bottom:8px;">📈 최고 순위 추이 (낮을수록 상위)</p><div class="chart-wrap2"><canvas id="brandRankChart"></canvas></div></div>
        <div><p style="font-size:12px;color:#666;margin-bottom:8px;">📦 TOP100 내 상품 수</p><div class="chart-wrap2"><canvas id="brandCountChart"></canvas></div></div>
      </div>
      <div id="brand-products-wrap"></div>
    </div>
  </div>
</div>

<script>
const CURRENCY = ${json(currency)};
const ALL_DATES = ${json(allDates)};
const CAT_LABELS = ${json(catLabels)};
const CATS = ${json(categories)};
const RANK_CHARTS = ${json(rankCharts)};
const BRAND_HISTORY = ${json(brandHistory)};
const BRAND_NAMES = ${json(brandNamesByCat)};
const TODAY = ${json(todayByCat)};
const PRODUCTS = ${json(products)};
const KEYWORD_BY_MONTH = ${json(keywordByMonth)};
const KW_TYPES = ${json(KW_TYPES)};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtPrice = v => v == null ? '-' : CURRENCY === 'USD' ? '$' + (+v).toFixed(2) : Math.round(+v).toLocaleString('ko-KR') + '원';

// 순위 추이 차트: 화면에 보이는 상태에서 만든 뒤 cat-only 를 숨긴다(크기 계산 문제 방지)
CATS.forEach(cat => {
  const el = document.getElementById('rankChart-' + cat);
  if (!el) return;
  new Chart(el, {
    type: 'line', data: RANK_CHARTS[cat],
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { reverse: true, min: 1, title: { display: true, text: '순위' } } },
      plugins: { legend: { position: window.innerWidth < 600 ? 'bottom' : 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.raw + '위' } } } },
  });
});
document.querySelectorAll('.cat-only').forEach(el => { el.style.display = 'none'; });

function switchCat(cat, btn) {
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const kw = document.getElementById('keyword-search-section');
  const bar = document.getElementById('kw-month-bar');
  const brand = document.getElementById('brand-analysis-card');
  if (cat === 'keyword') {
    document.querySelectorAll('[data-cat]').forEach(el => { if (!el.classList.contains('brand-link')) el.style.display = 'none'; });
    bar.style.display = 'none'; brand.style.display = 'none'; kw.style.display = 'block';
    document.body.classList.remove('show-rest');
    document.getElementById('kw-input').focus();
    return;
  }
  kw.style.display = 'none'; bar.style.display = ''; brand.style.display = '';
  const showRest = cat !== 'all';
  document.body.classList.toggle('show-rest', showRest);
  document.querySelectorAll('.top-n').forEach(el => { el.textContent = showRest ? '100' : '10'; });
  document.querySelectorAll('.cat-section, .cat-only').forEach(el => {
    const match = cat === 'all' || cat === el.dataset.cat;
    const hide = cat === 'all' && el.classList.contains('cat-only');
    el.style.display = match && !hide ? '' : 'none';
  });
  if (cat !== 'all') { document.getElementById('brand-cat-sel').value = cat; refreshBrandList(); }
}

const KW_CLASS = { '제품': 'prod', '성분': 'ingr', '효능': 'effi', '마케팅': 'mkt' };
function renderKeywords(month) {
  const perCat = KEYWORD_BY_MONTH[month] || {};
  CATS.forEach(cat => {
    const box = document.getElementById('kwtypes-' + cat);
    const byType = perCat[cat] || {};
    if (!KW_TYPES.some(t => (byType[t] || []).length)) { box.innerHTML = '<p class="no-data" style="grid-column:1/-1;">이 달 추출된 키워드가 없어요.</p>'; return; }
    box.innerHTML = KW_TYPES.map(t => '<div><div class="kw-type-h kw-t-' + KW_CLASS[t] + '">' + t + '</div>' +
      ((byType[t] || []).map(r => '<span class="kw-chip">' + esc(r.w) + '<b>' + r.n + '</b></span>').join('') || '<span class="no-data" style="font-size:12px;">-</span>') + '</div>').join('');
  });
}
(function () { const s = document.getElementById('kw-month-sel'); if (s && s.value) renderKeywords(s.value); })();

// ── 키워드 검색 ──
let kwFrom = ALL_DATES[0] || '', kwTo = ALL_DATES[ALL_DATES.length - 1] || '';
(function () {
  const f = document.getElementById('kw-from'), t = document.getElementById('kw-to');
  f.min = t.min = kwFrom; f.max = t.max = kwTo; f.value = kwFrom; t.value = kwTo;
})();
function kwSetPeriod(days, btn) {
  document.querySelectorAll('.kw-period').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const max = ALL_DATES[ALL_DATES.length - 1];
  let min = ALL_DATES[0];
  if (days) { const c = new Date(max); c.setDate(c.getDate() - (days - 1)); const cs = c.toISOString().slice(0, 10); min = ALL_DATES.find(d => d >= cs) || min; }
  kwFrom = min; kwTo = max;
  document.getElementById('kw-from').value = min; document.getElementById('kw-to').value = max;
  kwSearch();
}
function kwSetCustom() {
  const f = document.getElementById('kw-from').value, t = document.getElementById('kw-to').value;
  if (!f || !t) return;
  kwFrom = f; kwTo = t < f ? f : t;
  document.querySelectorAll('.kw-period').forEach(b => b.classList.remove('active'));
  kwSearch();
}
function kwSearch() {
  const q = document.getElementById('kw-input').value.trim().toLowerCase();
  const meta = document.getElementById('kw-meta'), box = document.getElementById('kw-results');
  if (!q) { meta.textContent = ''; box.innerHTML = '<p class="kw-empty">검색어를 입력하면 결과가 표시됩니다.</p>'; return; }
  const res = PRODUCTS.filter(p => (p.n || '').toLowerCase().includes(q) || (p.b || '').toLowerCase().includes(q)).map(p => {
    const e = Object.entries(p.d).filter(([d]) => d >= kwFrom && d <= kwTo);
    if (!e.length) return null;
    const r = e.map(x => x[1][0]), pr = e.map(x => x[1][1]).filter(v => v != null), ds = e.map(x => x[0]).sort();
    return { p, avg: Math.round(r.reduce((a, b) => a + b, 0) / r.length * 10) / 10, best: Math.min(...r), worst: Math.max(...r),
      minP: pr.length ? Math.min(...pr) : null, maxP: pr.length ? Math.max(...pr) : null, cnt: ds.length, first: ds[0], last: ds[ds.length - 1] };
  }).filter(Boolean).sort((a, b) => a.avg - b.avg);
  meta.textContent = res.length ? res.length + '개 제품' : '';
  if (!res.length) { box.innerHTML = '<p class="kw-empty">"' + esc(q) + '" 검색 결과가 없습니다.</p>'; return; }
  box.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>카테고리</th><th>브랜드</th><th>제품명</th><th>평균 순위</th><th>최고</th><th>최저</th><th>최저가</th><th>최고가</th><th>노출일수</th><th>첫 등장</th><th>마지막 등장</th></tr></thead><tbody>' +
    res.map(s => '<tr><td><span class="kw-tag">' + esc(CAT_LABELS[s.p.c] || s.p.c) + '</span></td><td style="font-weight:600;white-space:nowrap;">' + esc(s.p.b || '-') +
      '</td><td class="pname" title="' + esc(s.p.n) + '">' + esc(s.p.n) + '</td><td style="font-weight:700;color:#1b4332;">' + s.avg + '위</td><td class="up">' + s.best +
      '위</td><td style="color:#3498db;">' + s.worst + '위</td><td>' + fmtPrice(s.minP) + '</td><td>' + fmtPrice(s.maxP) + '</td><td>' + s.cnt +
      '일</td><td style="font-size:12px;color:#999;">' + s.first + '</td><td style="font-size:12px;color:#999;">' + s.last + '</td></tr>').join('') +
    '</tbody></table></div>';
}

// ── 브랜드 상세 ──
function refreshBrandList() {
  const cat = document.getElementById('brand-cat-sel').value;
  document.getElementById('brand-sel').innerHTML = '<option value="">-- 브랜드를 선택하세요 --</option>' +
    (BRAND_NAMES[cat] || []).map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join('');
  document.getElementById('brand-detail').classList.remove('show');
}
function selectBrand(cat, brand) {
  document.getElementById('brand-cat-sel').value = cat;
  refreshBrandList();
  document.getElementById('brand-sel').value = brand;
  showBrandDetail();
  document.getElementById('brand-analysis-card').scrollIntoView({ behavior: 'smooth' });
}
let rankChart = null, countChart = null;
function showBrandDetail() {
  const cat = document.getElementById('brand-cat-sel').value, brand = document.getElementById('brand-sel').value;
  const detail = document.getElementById('brand-detail');
  if (!brand) { detail.classList.remove('show'); return; }
  const h = (BRAND_HISTORY[cat] || {})[brand] || {};
  const dates = ALL_DATES.filter(d => h[d]);
  if (rankChart) rankChart.destroy();
  rankChart = new Chart(document.getElementById('brandRankChart'), {
    type: 'line', data: { labels: dates, datasets: [{ data: dates.map(d => h[d].rank), borderColor: '#40916c', backgroundColor: 'rgba(64,145,108,.15)', tension: .3, pointRadius: 3, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { reverse: true, min: 1 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.raw + '위' } } } },
  });
  if (countChart) countChart.destroy();
  countChart = new Chart(document.getElementById('brandCountChart'), {
    type: 'bar', data: { labels: dates, datasets: [{ data: dates.map(d => h[d].n), backgroundColor: 'rgba(64,145,108,.6)' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.raw + '개' } } } },
  });
  const prods = (TODAY[cat] || []).filter(p => p.b === brand);
  document.getElementById('brand-products-wrap').innerHTML = !prods.length ? '<p class="no-data">오늘 랭킹에 없음</p>' :
    '<p style="font-size:12px;color:#666;margin-bottom:8px;">오늘 랭킹 상품</p><div class="tbl-wrap"><table><thead><tr><th>순위</th><th>상품명</th><th>정가</th><th>판매가</th><th>할인율</th><th>평점(리뷰)</th></tr></thead><tbody>' +
    prods.map(p => '<tr><td>' + p.r + '위</td><td>' + esc(p.n) + '</td><td>' + fmtPrice(p.lp) + '</td><td>' + fmtPrice(p.sp) + '</td><td>' +
      (p.dr ? Math.round(p.dr * 100) + '%' : '-') + '</td><td>' + (p.rt != null ? '★' + (+p.rt).toFixed(1) + (p.rv != null ? ' (' + (+p.rv).toLocaleString() + ')' : '') : '-') + '</td></tr>').join('') +
    '</tbody></table></div>';
  detail.classList.add('show');
}
refreshBrandList();
</script>
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fromJson = args['from-json'] ? JSON.parse(fs.readFileSync(args['from-json'], 'utf8')) : null;
  let written = 0;
  for (const P of PLATFORMS) {
    const rows = fromJson ? fromJson.filter(r => r.platform === P.key) : await fetchPlatformRows(P.key);
    if (rows.length === 0) { console.log(`  ⚠️  ${P.key}: 데이터 없음 — 페이지 생성 건너뜀`); continue; }
    const A = aggregate(P, rows);
    const out = path.join(OUT_DIR, P.file);
    fs.writeFileSync(out, buildHtml(P, A), 'utf8');
    written++;
    console.log(`  ✅ ${P.key}: ${rows.length}행, ${A.allDates.length}일 (${A.allDates[0]}~${A.latestDate}) → ${out}`);
  }
  if (written === 0) throw new Error('생성된 페이지가 없음');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
