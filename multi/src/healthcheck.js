// 매일 아침 점검: 어제(KST) 데이터가 플랫폼·카테고리별로 제대로 쌓였는지 확인한다.
// 문제가 있으면 내용을 출력하고 exit 1 → 워크플로우가 알림 이슈를 연다.
// 국내 올영(oy_kr)은 기존 트래커 수집이 오후에 끝나 하루 늦게 복사되므로 그저께 날짜를 본다.
const { db } = require('./lib/db');
const { kstDate } = require('./lib/util');
const SOURCES = require('./sources');

const MIN_ROWS = 90;
const DAY = 86400000;

async function countRows(platform, date) {
  const { data, error } = await db().from('rk_snapshots').select('category')
    .eq('platform', platform).eq('snapshot_date', date).limit(5000);
  if (error) throw new Error(`rk_snapshots 조회 실패: ${error.message}`);
  const counts = {};
  data.forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1; });
  return counts;
}

async function main() {
  // HEALTHCHECK_TODAY=YYYY-MM-DD 로 기준일을 바꿔 점검할 수 있다 (시험용)
  const base = process.env.HEALTHCHECK_TODAY ? new Date(`${process.env.HEALTHCHECK_TODAY}T12:00:00+09:00`).getTime() : Date.now();
  const yesterday = kstDate(new Date(base - DAY));
  const twoDaysAgo = kstDate(new Date(base - 2 * DAY));
  const checks = [
    { platform: 'musinsa',   date: yesterday },
    { platform: 'oy_global', date: yesterday },
    { platform: 'oy_kr',     date: twoDaysAgo },
  ];

  const problems = [];
  const lines = [];
  for (const { platform, date } of checks) {
    const counts = await countRows(platform, date);
    for (const { category, label } of SOURCES[platform].categories) {
      const n = counts[category] || 0;
      const ok = n >= MIN_ROWS;
      lines.push(`${ok ? '✅' : '❌'} ${platform} / ${label} (${date}): ${n}개`);
      if (!ok) problems.push(`${platform} / ${label} (${date}): ${n}개 (기준 ${MIN_ROWS}개 이상)`);
    }
  }

  const { data: failedRuns } = await db().from('rk_scrape_runs').select('platform, category, error')
    .eq('snapshot_date', yesterday).eq('status', 'failed');
  (failedRuns || []).forEach(r => lines.push(`⚠️  실패 기록: ${r.platform} / ${r.category} — ${r.error}`));

  console.log(lines.join('\n'));
  if (problems.length) {
    const fs = require('fs');
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.map(l => `- ${l}`).join('\n') + '\n');
    fs.writeFileSync('healthcheck-problems.txt', problems.map(p => `- ${p}`).join('\n') + '\n');
    console.error(`\n문제 ${problems.length}건`);
    process.exit(1);
  }
  console.log('\n모든 플랫폼·카테고리 정상');
}

main().catch(err => { console.error(err); process.exit(1); });
