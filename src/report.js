const { getSheets, readSheet } = require('./sheets');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// 시트 행 → 객체
function toObj(headers, row) {
  const o = {};
  headers.forEach((h, i) => o[h] = row[i] ?? '');
  return o;
}

async function generateReport() {
  console.log('\n[리포트] 대시보드 생성 중...');
  const sheets = await getSheets();

  // 데이터 읽기
  const rawRows     = await readSheet(sheets, 'raw_snapshots');
  const changeRows  = await readSheet(sheets, 'daily_changes');

  if (rawRows.length < 2) {
    console.log('  데이터가 아직 없어요. 수집 후 다시 시도하세요.');
    return;
  }

  const rawHeaders    = rawRows[0];
  const changeHeaders = changeRows[0] || [];

  const snapshots = rawRows.slice(1).map(r => toObj(rawHeaders, r));
  const changes   = changeRows.slice(1).map(r => toObj(changeHeaders, r));

  // 날짜 목록 (최신순)
  const dates = [...new Set(snapshots.map(r => r.snapshot_date))].sort().reverse();
  const latestDate = dates[0];

  // 날짜별 데이터 그룹
  const byDate = {};
  dates.forEach(d => {
    byDate[d] = snapshots.filter(r => r.snapshot_date === d)
                         .sort((a, b) => +a.rank - +b.rank);
  });

  // 오특 이벤트 날짜 집합 (has_otuk === 'true' 인 상품이 하나라도 있는 날)
  const otukDates = new Set(
    snapshots
      .filter(r => r.has_otuk === 'true' || r.has_otuk === true)
      .map(r => r.snapshot_date)
  );

  // 오특 날짜별 상품 목록
  const otukByDate = {};
  snapshots
    .filter(r => r.has_otuk === 'true' || r.has_otuk === true)
    .forEach(r => {
      if (!otukByDate[r.snapshot_date]) otukByDate[r.snapshot_date] = [];
      otukByDate[r.snapshot_date].push(r);
    });

  // 브랜드별 순위 추이 (최근 14일)
  const recentDates = dates.slice(0, 14).reverse();
  const brands = [...new Set(snapshots.map(r => r.brand_name_raw))];

  // 브랜드별 날짜별 순위 맵
  const rankMap = {}; // brand → { date: rank }
  snapshots.forEach(r => {
    if (!rankMap[r.brand_name_raw]) rankMap[r.brand_name_raw] = {};
    rankMap[r.brand_name_raw][r.snapshot_date] = +r.rank;
  });

  // 최신일 상위 10 브랜드
  const top10brands = (byDate[latestDate] || []).slice(0, 10).map(r => r.brand_name_raw);

  // 변동 데이터 (최신일)
  const todayChanges = changes.filter(r => r.snapshot_date === latestDate);
  const risers = todayChanges
    .filter(r => +r.rank_change > 0)
    .sort((a, b) => +b.rank_change - +a.rank_change)
    .slice(0, 5);
  const fallers = todayChanges
    .filter(r => +r.rank_change < 0)
    .sort((a, b) => +a.rank_change - +b.rank_change)
    .slice(0, 5);
  const priceChanges = todayChanges
    .filter(r => r.is_price_changed === 'true');

  // Chart.js용 데이터 직렬화
  const chartData = {
    labels: recentDates,
    datasets: top10brands.map((brand, i) => {
      const colors = [
        '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7',
        '#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9'
      ];
      return {
        label: brand,
        data: recentDates.map(d => rankMap[brand]?.[d] || null),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + '33',
        tension: 0.3,
        spanGaps: true,
      };
    })
  };

  // 날짜별 TOP5 테이블 데이터
  const tableData = dates.slice(0, 7).map(d => ({
    date: d,
    products: (byDate[d] || []).slice(0, 5),
  }));

  // 오늘 오특 여부
  const todayHasOtuk = otukDates.has(latestDate);

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>올리브영 스킨케어 랭킹 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; background: #f5f7fa; color: #333; }
  header { background: linear-gradient(135deg, #2d6a4f, #40916c); color: white; padding: 24px 32px; }
  header h1 { font-size: 22px; font-weight: 700; }
  header p  { font-size: 13px; opacity: 0.8; margin-top: 4px; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-bottom: 20px; }
  .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
  .card h2 { font-size: 15px; font-weight: 700; margin-bottom: 14px; color: #2d6a4f; display: flex; align-items: center; gap: 6px; }
  .full { grid-column: 1 / -1; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f0f7f4; padding: 8px 10px; text-align: left; font-size: 12px; color: #666; border-bottom: 2px solid #e0ede8; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f9fdf9; }
  .rank-badge { display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; font-size: 11px; font-weight: 700; }
  .rank-1 { background: #FFD700; color: #333; }
  .rank-2 { background: #C0C0C0; color: #333; }
  .rank-3 { background: #CD7F32; color: white; }
  .rank-n { background: #e8f5e9; color: #2d6a4f; }
  .up   { color: #e74c3c; font-weight: 700; }
  .down { color: #3498db; font-weight: 700; }
  .tag { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 11px; margin: 1px; }
  .tag-sale   { background: #ffe0e0; color: #e74c3c; }
  .tag-coupon { background: #fff3cd; color: #856404; }
  .tag-new    { background: #d4edda; color: #155724; }
  .tag-other  { background: #e8eaf6; color: #3949ab; }
  .price-down { color: #e74c3c; }
  .price-up   { color: #3498db; }
  .stat-box { text-align: center; padding: 16px; border-radius: 10px; }
  .stat-box .num { font-size: 32px; font-weight: 800; }
  .stat-box .lbl { font-size: 12px; color: #888; margin-top: 4px; }
  .stat-green { background: #e8f5e9; color: #2d6a4f; }
  .stat-blue  { background: #e3f2fd; color: #1565c0; }
  .stat-orange{ background: #fff3e0; color: #e65100; }
  .stat-pink  { background: #fce4ec; color: #880e4f; }
  .otuk-banner { background: linear-gradient(135deg, #ff6b35, #f7c59f); color: white; border-radius: 12px; padding: 16px 24px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; }
  .otuk-banner .icon { font-size: 32px; }
  .otuk-banner h3 { font-size: 17px; font-weight: 700; }
  .otuk-banner p  { font-size: 13px; opacity: 0.9; margin-top: 2px; }
  .otuk-badge { display: inline-block; background: #ff6b35; color: white; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 10px; margin-left: 4px; }
  .date-otuk { background: #fff3ee !important; border-color: #ff6b35 !important; color: #ff6b35 !important; font-weight: 700; }
  .date-nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .date-btn { padding: 5px 14px; border: 1px solid #ddd; border-radius: 20px; font-size: 12px; cursor: pointer; background: white; }
  .date-btn.active { background: #2d6a4f; color: white; border-color: #2d6a4f; }
  .chart-wrap { height: 300px; }
  .no-data { color: #aaa; font-size: 13px; padding: 20px 0; text-align: center; }
  @media (max-width: 768px) { .grid-2, .grid-3 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>🛍️ 올리브영 스킨케어 랭킹 대시보드</h1>
  <p>기준: ${latestDate} &nbsp;|&nbsp; 누적 수집일: ${dates.length}일 &nbsp;|&nbsp; 총 스냅샷: ${snapshots.length}건</p>
</header>

<div class="container">

  <!-- 오특 배너 (오특이 있는 날만 표시) -->
  ${todayHasOtuk ? `
  <div class="otuk-banner">
    <div class="icon">🔥</div>
    <div>
      <h3>오늘은 오특(오늘의 특가) 진행일입니다!</h3>
      <p>${(otukByDate[latestDate]||[]).map(p=>`${p.brand_name_raw} [${p.rank}위]`).join(' · ')}</p>
    </div>
  </div>` : ''}

  <!-- 요약 통계 -->
  <div class="grid-3" style="margin-bottom:20px;">
    <div class="stat-box stat-green"><div class="num">${dates.length}</div><div class="lbl">수집 완료 일수</div></div>
    <div class="stat-box stat-blue"><div class="num">${[...new Set(snapshots.map(r=>r.brand_name_raw))].length}</div><div class="lbl">누적 등장 브랜드</div></div>
    <div class="stat-box stat-orange"><div class="num">${otukDates.size}</div><div class="lbl">누적 오특 진행일 🔥</div></div>
  </div>

  <!-- 순위 추이 차트 -->
  <div class="card full" style="margin-bottom:20px;">
    <h2>📈 TOP 10 브랜드 순위 추이</h2>
    ${recentDates.length < 2
      ? '<p class="no-data">데이터가 2일 이상 쌓이면 차트가 표시됩니다.</p>'
      : '<div class="chart-wrap"><canvas id="rankChart"></canvas></div>'
    }
  </div>

  <!-- 오늘 TOP 10 + 변동 -->
  <div class="grid-2">
    <div class="card">
      <h2>🏆 오늘 TOP 10 (${latestDate})</h2>
      <table>
        <thead><tr><th>순위</th><th>브랜드</th><th>상품명</th><th>판매가</th><th>할인</th></tr></thead>
        <tbody>
        ${(byDate[latestDate]||[]).slice(0,10).map(p => {
          const rankClass = +p.rank===1?'rank-1':+p.rank===2?'rank-2':+p.rank===3?'rank-3':'rank-n';
          const disc = p.price_discount_rate ? Math.round(+p.price_discount_rate*100)+'%' : '-';
          const price = p.sale_price ? (+p.sale_price).toLocaleString()+'원' : '-';
          return `<tr>
            <td><span class="rank-badge ${rankClass}">${p.rank}</span></td>
            <td>${p.brand_name_raw}</td>
            <td style="max-width:160px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${p.product_name_raw}</td>
            <td>${price}</td>
            <td>${disc}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>🔄 전일 대비 순위 변동</h2>
      ${risers.length === 0 && fallers.length === 0
        ? '<p class="no-data">전일 데이터가 쌓이면 표시됩니다.</p>'
        : `<table>
            <thead><tr><th>브랜드</th><th>오늘</th><th>전일</th><th>변동</th></tr></thead>
            <tbody>
            ${risers.map(r=>`<tr>
              <td>${r.brand_key}</td>
              <td>${r.today_rank}위</td>
              <td>${r.yesterday_rank}위</td>
              <td class="up">▲ ${r.rank_change}</td>
            </tr>`).join('')}
            ${fallers.map(r=>`<tr>
              <td>${r.brand_key}</td>
              <td>${r.today_rank}위</td>
              <td>${r.yesterday_rank}위</td>
              <td class="down">▼ ${Math.abs(r.rank_change)}</td>
            </tr>`).join('')}
            </tbody>
          </table>`
      }
    </div>
  </div>

  <!-- 가격 변동 -->
  <div class="card full" style="margin-top:20px;">
    <h2>💰 오늘 가격 변동 상품</h2>
    ${priceChanges.length === 0
      ? '<p class="no-data">오늘 가격 변동 상품이 없어요.</p>'
      : `<table>
          <thead><tr><th>브랜드</th><th>오늘 가격</th><th>전일 가격</th><th>변동액</th><th>변동률</th></tr></thead>
          <tbody>
          ${priceChanges.map(c => {
            const diff = +c.price_change;
            const cls  = diff > 0 ? 'price-up' : 'price-down';
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
          </tbody>
        </table>`
    }
  </div>

  <!-- 날짜별 TOP5 히스토리 -->
  <div class="card full" style="margin-top:20px;">
    <h2>📅 날짜별 TOP 5 히스토리</h2>
    <div class="date-nav">
      ${tableData.map((d,i)=>{
        const isOtuk = otukDates.has(d.date);
        return `<button class="date-btn${i===0?' active':''}${isOtuk?' date-otuk':''}" onclick="showDate(${i},this)">${d.date}${isOtuk?' 🔥':''}</button>`;
      }).join('')}
    </div>
    ${tableData.map((d,i)=>`
      <div id="date-table-${i}" style="display:${i===0?'block':'none'}">
        <table>
          <thead><tr><th>순위</th><th>브랜드</th><th>상품명</th><th>정가</th><th>판매가</th><th>할인율</th><th>배지</th></tr></thead>
          <tbody>
          ${d.products.map(p=>{
            const rankClass = +p.rank===1?'rank-1':+p.rank===2?'rank-2':+p.rank===3?'rank-3':'rank-n';
            const disc = p.price_discount_rate ? Math.round(+p.price_discount_rate*100)+'%' : '-';
            const list  = p.list_price  ? (+p.list_price).toLocaleString()+'원'  : '-';
            const sale  = p.sale_price  ? (+p.sale_price).toLocaleString()+'원'  : '-';
            const badges = (p.badges||'').split(',').filter(Boolean).map(b=>{
              const cls = b==='세일'?'tag-sale':b==='쿠폰'?'tag-coupon':b==='NEW'?'tag-new':'tag-other';
              return `<span class="tag ${cls}">${b}</span>`;
            }).join('');
            return `<tr>
              <td><span class="rank-badge ${rankClass}">${p.rank}</span></td>
              <td>${p.brand_name_raw}</td>
              <td>${p.product_name_raw.slice(0,30)}</td>
              <td>${list}</td><td>${sale}</td><td>${disc}</td>
              <td>${badges}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    `).join('')}
  </div>

  <!-- 오특 히스토리 -->
  <div class="card full" style="margin-top:20px;">
    <h2>🔥 오특 진행 이력</h2>
    ${otukDates.size === 0
      ? '<p class="no-data">아직 오특 이벤트가 감지되지 않았어요. 오특 진행일에 자동으로 기록됩니다.</p>'
      : `<table>
          <thead><tr><th>날짜</th><th>오특 상품 수</th><th>브랜드 목록</th></tr></thead>
          <tbody>
          ${[...otukDates].sort().reverse().map(d => {
            const items = otukByDate[d] || [];
            return `<tr>
              <td><strong>${d}</strong> <span class="otuk-badge">오특</span></td>
              <td>${items.length}개</td>
              <td>${items.map(p=>`${p.brand_name_raw}(${p.rank}위)`).join(', ')}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>`
    }
  </div>

</div>

<script>
// 날짜 탭 전환
function showDate(idx, btn) {
  document.querySelectorAll('[id^="date-table-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.date-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('date-table-' + idx).style.display = 'block';
  btn.classList.add('active');
}

// 순위 추이 차트
${recentDates.length >= 2 ? `
const ctx = document.getElementById('rankChart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: ${JSON.stringify(chartData)},
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        reverse: true,
        min: 1,
        title: { display: true, text: '순위 (낮을수록 상위)' },
        ticks: { stepSize: 1 }
      },
      x: { title: { display: true, text: '날짜' } }
    },
    plugins: {
      legend: { position: 'right' },
      tooltip: {
        callbacks: {
          label: ctx => ctx.dataset.label + ': ' + ctx.raw + '위'
        }
      }
    }
  }
});` : ''}
</script>
</body>
</html>`;

  const outPath = path.join('..', 'dashboard.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`  ✅ 대시보드 생성: du claude/dashboard.html`);
}

module.exports = { generateReport };

if (require.main === module) {
  generateReport().catch(err => { console.error(err.message); process.exit(1); });
}
