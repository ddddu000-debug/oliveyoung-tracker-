// KST 기준 날짜 (YYYY-MM-DD). 실행 시각이 바뀌어도 날짜가 밀리지 않도록 고정.
function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function makeRunId() {
  const s = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return s.slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function brandKey(brand) {
  return (brand || '').replace(/\s+/g, '').toLowerCase();
}

function discountRate(list, sale) {
  if (!list || !sale || list <= 0 || sale > list) return null;
  return Math.round(((list - sale) / list) * 1000) / 1000;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { kstDate, makeRunId, parseNum, brandKey, discountRate, sleep };
