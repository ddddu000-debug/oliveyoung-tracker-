const { fetchAllSnapshots, fetchAllChanges } = require('./database');
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
  const categories  = [...new Set(snaps.map(r => r.category))];

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
  // daily_changes에 category가 없으므로 product_key로 카테고리 매핑
  const keyToCategory = {};
  snaps.filter(s => s.snapshot_date === latestDate)
       .forEach(s => { if (s.product_key) keyToCategory[s.product_key] = s.category; });

  const todayChanges = changes.filter(c => c.snapshot_date === latestDate);
  todayChanges.forEach(c => {
    c._category = keyToCategory[c.product_key] || 'unknown';
  });

  // ── 직렬화할 데이터 오브젝트 ──────────────────────────────────────
  const DATA = {
    latestDate,
    allDates,
    categories,
    catLabels: { skincare: '스킨케어', bodycare: '바디케어' },
    byCategDate,
    brandHistory,
    otukDates: Object.fromEntries(
      Object.entries(otukDates).map(([k, v]) => [k, [...v]])
    ),
    todayChanges,
  };

  // ── HTML 생성 ─────────────────────────────────────────────────────
  const html = buildHtml(DATA);
  const outPath = process.env.DASHBOARD_PATH || path.join('..', 'dashboard.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  ✅ 대시보드 생성: ${outPath}`);
}

function buildHtml(D) {
  const { latestDate, allDates, categories, catLabels,
          byCategDate, brandHistory, otukDates, todayChanges } = D;

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

@media(max-width:768px){.grid2,.grid3{grid-template-columns:1fr;}}
</style>
</head>
<body>
<header>
  <h1>🛍️ 올리브영 랭킹 대시보드</h1>
  <p>기준: ${latestDate} &nbsp;|&nbsp; 수집일: ${allDates.length}일 &nbsp;|&nbsp; 카테고리: ${categories.map(c => catLabels[c]||c).join(', ')}</p>
</header>

<div class="wrap">

  <!-- 카테고리 탭 -->
  <div class="cat-tabs">
    <button class="cat-tab active" onclick="switchCat('all',this)">📊 전체</button>
    ${categories.map(c => `<button class="cat-tab" onclick="switchCat('${c}',this)">${catLabels[c]||c}</button>`).join('')}
  </div>

  <!-- 오특 배너 (카테고리별 표시) -->
  <div id="otuk-banners">
    ${categories.map(cat => {
      const hasOtuk = otukDates[cat]?.includes(latestDate);
      if (!hasOtuk) return '';
      const items = (byCategDate[cat]?.[latestDate] || []).filter(p => p.has_otuk === 'true');
      return `<div class="otuk-banner" data-cat="${cat}">
        <div class="ico">🔥</div>
        <div>
          <h3>[${catLabels[cat]||cat}] 오늘 오특(오늘의 특가) 진행 중!</h3>
          <p>${items.slice(0,5).map(p=>`${p.brand_name_raw}(${p.rank}위)`).join(' · ')}</p>
        </div>
      </div>`;
    }).join('')}
  </div>

  <!-- 요약 통계 -->
  <div class="grid3" id="stats-area">
    ${categories.map(cat => {
      const todaySnaps = byCategDate[cat]?.[latestDate] || [];
      return `<div class="stat s-green" data-cat="${cat}">
        <div class="n">${todaySnaps.length}</div>
        <div class="l">${catLabels[cat]||cat} 수집 상품</div>
      </div>`;
    }).join('')}
    <div class="stat s-orange">
      <div class="n">${Object.values(otukDates).reduce((s,v)=>s+v.length,0)}</div>
      <div class="l">누적 오특 진행일 🔥</div>
    </div>
  </div>

  <!-- TOP10 + 순위 변동 (카테고리별) -->
  ${categories.map(cat => {
    const todaySnaps  = byCategDate[cat]?.[latestDate] || [];
    const catChanges  = todayChanges.filter(c => c._category === cat);
    const risers  = catChanges.filter(c => +c.rank_change > 0).sort((a,b)=>+b.rank_change - +a.rank_change).slice(0,5);
    const fallers = catChanges.filter(c => +c.rank_change < 0).sort((a,b)=>+a.rank_change - +b.rank_change).slice(0,5);

    return `<div class="grid2 cat-section" data-cat="${cat}">
      <div class="card">
        <h2>🏆 ${catLabels[cat]||cat} 오늘 TOP 10</h2>
        <table><thead><tr><th>#</th><th>브랜드</th><th>상품명</th><th>판매가</th><th>할인</th><th>배지</th></tr></thead><tbody>
        ${todaySnaps.slice(0,10).map(p => {
          const rc  = +p.rank === 1 ? 'r1' : +p.rank === 2 ? 'r2' : +p.rank === 3 ? 'r3' : 'rn';
          const disc = p.price_discount_rate ? Math.round(+p.price_discount_rate*100)+'%' : '-';
          const badges = (p.badges||'').split(',').filter(Boolean).map(b => {
            const cls = b==='오특'?'t-otuk':b==='세일'?'t-sale':b==='쿠폰'?'t-coupon':'t-other';
            return `<span class="tag ${cls}">${b}</span>`;
          }).join('');
          return `<tr>
            <td><span class="rb ${rc}">${p.rank}</span></td>
            <td><a href="#" onclick="selectBrand('${cat}','${p.brand_name_raw.replace(/'/g,"\\'")}');return false;"
              style="color:#1b4332;font-weight:600;text-decoration:none;">${p.brand_name_raw}</a></td>
            <td style="max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${p.product_name_raw}</td>
            <td>${p.sale_price ? (+p.sale_price).toLocaleString()+'원' : '-'}</td>
            <td>${disc}</td>
            <td>${badges}</td>
          </tr>`;
        }).join('')}
        </tbody></table>
      </div>

      <div class="card">
        <h2>🔄 ${catLabels[cat]||cat} 순위 변동</h2>
        ${risers.length === 0 && fallers.length === 0
          ? '<p class="no-data">전일 데이터가 쌓이면 표시됩니다.</p>'
          : `<table><thead><tr><th>브랜드</th><th>오늘</th><th>전일</th><th>변동</th></tr></thead><tbody>
            ${risers.map(r=>`<tr><td>${r.brand_key}</td><td>${r.today_rank}위</td><td>${r.yesterday_rank}위</td><td class="up">▲ ${r.rank_change}</td></tr>`).join('')}
            ${fallers.map(r=>`<tr><td>${r.brand_key}</td><td>${r.today_rank}위</td><td>${r.yesterday_rank}위</td><td class="dn">▼ ${Math.abs(+r.rank_change)}</td></tr>`).join('')}
          </tbody></table>`
        }
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

    return `<div class="card cat-section" data-cat="${cat}">
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
              legend:{position:'right',labels:{font:{size:11}}},
              tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.raw+'위'}}
            }
          }
        });
      })();
      </script>
    </div>`;
  }).join('')}

  <!-- 브랜드 분석 -->
  <div class="card full">
    <h2>🔍 브랜드별 상세 분석</h2>
    <div class="brand-select-area">
      <span style="font-size:13px;font-weight:600;color:#555;">카테고리</span>
      <select id="brand-cat-sel" onchange="refreshBrandList()">
        ${categories.map(c => `<option value="${c}">${catLabels[c]||c}</option>`).join('')}
      </select>
      <span style="font-size:13px;font-weight:600;color:#555;">브랜드</span>
      <select id="brand-sel" onchange="showBrandDetail()">
        <option value="">브랜드를 선택하세요</option>
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

  <!-- 가격 변동 -->
  ${categories.map(cat => {
    const priceChanged = todayChanges.filter(c => c._category === cat && c.is_price_changed === 'true');
    return `<div class="card cat-section" data-cat="${cat}">
      <h2>💰 ${catLabels[cat]||cat} 가격 변동</h2>
      ${priceChanged.length === 0
        ? '<p class="no-data">오늘 가격 변동 없음</p>'
        : `<table><thead><tr><th>브랜드</th><th>오늘</th><th>전일</th><th>변동액</th><th>변동률</th></tr></thead><tbody>
          ${priceChanged.map(c => {
            const diff = +c.price_change;
            const cls  = diff > 0 ? 'price-up' : 'price-dn';
            const sign = diff > 0 ? '+' : '';
            const rate = c.price_change_rate ? sign+Math.round(+c.price_change_rate*100)+'%' : '-';
            return `<tr>
              <td>${c.brand_key}</td>
              <td>${(+c.today_sale_price).toLocaleString()}원</td>
              <td>${(+c.yesterday_sale_price).toLocaleString()}원</td>
              <td class="${cls}">${sign}${diff.toLocaleString()}원</td>
              <td class="${cls}">${rate}</td>
            </tr>`;
          }).join('')}
          </tbody></table>`
      }
    </div>`;
  }).join('')}

  <!-- 날짜별 히스토리 -->
  ${categories.map(cat => {
    const catDates = allDates.filter(d => byCategDate[cat]?.[d]).reverse().slice(0,7);
    return `<div class="card cat-section" data-cat="${cat}">
      <h2>📅 ${catLabels[cat]||cat} 날짜별 TOP5 히스토리</h2>
      <div class="date-nav">
        ${catDates.map((d,i) => {
          const isOtuk = otukDates[cat]?.includes(d);
          return `<button class="date-btn${i===0?' active':''}${isOtuk?' otuk-day':''}"
            onclick="showHistDate('${cat}','${d}',this)">${d}${isOtuk?' 🔥':''}</button>`;
        }).join('')}
      </div>
      ${catDates.map((d,i) => `
        <div id="hist-${cat}-${d}" style="display:${i===0?'block':'none'}">
          <table><thead><tr><th>#</th><th>브랜드</th><th>상품명</th><th>정가</th><th>판매가</th><th>할인율</th></tr></thead><tbody>
          ${(byCategDate[cat]?.[d]||[]).slice(0,5).map(p => {
            const rc = +p.rank===1?'r1':+p.rank===2?'r2':+p.rank===3?'r3':'rn';
            const disc = p.price_discount_rate ? Math.round(+p.price_discount_rate*100)+'%' : '-';
            return `<tr>
              <td><span class="rb ${rc}">${p.rank}</span></td>
              <td>${p.brand_name_raw}</td>
              <td>${p.product_name_raw.slice(0,30)}</td>
              <td>${p.list_price ? (+p.list_price).toLocaleString()+'원':'-'}</td>
              <td>${p.sale_price ? (+p.sale_price).toLocaleString()+'원':'-'}</td>
              <td>${disc}</td>
            </tr>`;
          }).join('')}
          </tbody></table>
        </div>`).join('')}
    </div>`;
  }).join('')}

  <!-- 오특 이력 -->
  <div class="card full">
    <h2>🔥 오특 진행 이력</h2>
    ${Object.values(otukDates).every(v=>v.length===0)
      ? '<p class="no-data">아직 오특 이벤트가 감지되지 않았어요.</p>'
      : categories.map(cat => {
          const dates = (otukDates[cat]||[]).sort().reverse();
          if (!dates.length) return '';
          return `<p style="font-weight:700;color:#1b4332;margin-bottom:8px;">${catLabels[cat]||cat}</p>
          <table style="margin-bottom:16px;"><thead><tr><th>날짜</th><th>상품 수</th><th>브랜드 목록</th></tr></thead><tbody>
          ${dates.map(d => {
            const items = (byCategDate[cat]?.[d]||[]).filter(p=>p.has_otuk==='true');
            return `<tr>
              <td><strong>${d}</strong> <span class="tag t-otuk">오특</span></td>
              <td>${items.length}개</td>
              <td>${items.map(p=>`${p.brand_name_raw}(${p.rank}위)`).join(', ')}</td>
            </tr>`;
          }).join('')}
          </tbody></table>`;
        }).join('')
    }
  </div>

</div>

<script>
// ── 데이터 ────────────────────────────────────────────────────────
const BRAND_HISTORY = ${JSON.stringify(D.brandHistory)};
const ALL_DATES     = ${JSON.stringify(D.allDates)};
const BY_CATEG_DATE = ${JSON.stringify(D.byCategDate)};
const CAT_LABELS    = ${JSON.stringify(D.catLabels)};

// ── 카테고리 탭 전환 ──────────────────────────────────────────────
let currentCat = 'all';
function switchCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // cat-section 표시/숨김
  document.querySelectorAll('.cat-section').forEach(el => {
    const elCat = el.dataset.cat;
    el.style.display = (cat === 'all' || cat === elCat) ? '' : 'none';
  });

  // 오특 배너 표시/숨김
  document.querySelectorAll('[data-cat].otuk-banner, .otuk-banner[data-cat]').forEach(el => {
    el.style.display = (cat === 'all' || cat === el.dataset.cat) ? '' : 'none';
  });

  // 브랜드 드롭다운 카테고리 동기화
  if (cat !== 'all') {
    document.getElementById('brand-cat-sel').value = cat;
    refreshBrandList();
  }
}

// ── 날짜 히스토리 탭 ─────────────────────────────────────────────
function showHistDate(cat, date, btn) {
  btn.closest('.card').querySelectorAll('[id^="hist-'+cat+'-"]').forEach(el => el.style.display = 'none');
  btn.closest('.card').querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('hist-' + cat + '-' + date).style.display = 'block';
  btn.classList.add('active');
}

// ── 브랜드 목록 갱신 ─────────────────────────────────────────────
function refreshBrandList() {
  const cat = document.getElementById('brand-cat-sel').value;
  const sel = document.getElementById('brand-sel');
  sel.innerHTML = '<option value="">브랜드를 선택하세요</option>';

  const latestDate = ALL_DATES[ALL_DATES.length - 1];
  const todaySnaps = BY_CATEG_DATE[cat]?.[latestDate] || [];
  const brands = todaySnaps.map(p => p.brand_name_raw).filter(Boolean);
  const unique = [...new Set(brands)];

  unique.forEach(brand => {
    const opt = document.createElement('option');
    opt.value = brand;
    opt.textContent = brand;
    sel.appendChild(opt);
  });
  document.getElementById('brand-detail').classList.remove('show');
}

// ── 브랜드 상세 표시 ─────────────────────────────────────────────
let rankChart = null, priceChart = null;

function selectBrand(cat, brand) {
  document.getElementById('brand-cat-sel').value = cat;
  refreshBrandList();
  document.getElementById('brand-sel').value = brand;
  showBrandDetail();
  document.querySelector('.card.full').scrollIntoView({ behavior: 'smooth' });
}

function showBrandDetail() {
  const cat   = document.getElementById('brand-cat-sel').value;
  const brand = document.getElementById('brand-sel').value;
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
  const latestDate = ALL_DATES[ALL_DATES.length - 1];
  const todaySnaps = BY_CATEG_DATE[cat]?.[latestDate] || [];
  const brandProds = todaySnaps.filter(p => p.brand_name_raw === brand);

  const tableHtml = brandProds.length === 0 ? '<p class="no-data">오늘 랭킹에 없음</p>' :
    '<p style="font-size:12px;color:#666;margin-bottom:8px;">오늘 랭킹 상품</p>' +
    '<table><thead><tr><th>순위</th><th>상품명</th><th>정가</th><th>판매가</th><th>할인율</th><th>배지</th></tr></thead><tbody>' +
    brandProds.map(p => {
      const disc = p.price_discount_rate ? Math.round(+p.price_discount_rate*100)+'%' : '-';
      const badges = (p.badges||'').split(',').filter(Boolean).map(b => {
        const cls = b==='오특'?'t-otuk':b==='세일'?'t-sale':b==='쿠폰'?'t-coupon':'t-other';
        return '<span class="tag '+cls+'">'+b+'</span>';
      }).join('');
      return '<tr><td>'+p.rank+'위</td><td>'+p.product_name_raw+'</td><td>'+
        (p.list_price?(+p.list_price).toLocaleString()+'원':'-')+'</td><td>'+
        (p.sale_price?(+p.sale_price).toLocaleString()+'원':'-')+'</td><td>'+disc+'</td><td>'+badges+'</td></tr>';
    }).join('') + '</tbody></table>';

  document.getElementById('brand-products-wrap').innerHTML = tableHtml;
  detail.classList.add('show');
}

// 초기화: 브랜드 목록 로드
refreshBrandList();
</script>
</body>
</html>`;
}

module.exports = { generateReport };

if (require.main === module) {
  generateReport().catch(err => { console.error(err.message); process.exit(1); });
}
