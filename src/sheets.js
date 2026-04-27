const { google } = require('googleapis');
require('dotenv').config();

// raw_snapshots 헤더 순서
const RAW_HEADERS = [
  'snapshot_date', 'collected_at', 'run_id', 'category',
  'rank', 'product_name_raw', 'brand_name_raw',
  'list_price', 'sale_price', 'price_discount_amount', 'price_discount_rate',
  'product_url', 'badges', 'is_sold_out', 'has_otuk', 'source_url',
];

// Google Sheets 클라이언트 생성
async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// 시트의 모든 데이터 읽기
async function readSheet(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  return res.data.values || [];
}

// 시트에 행 추가
async function appendRows(sheets, sheetName, rows) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

// 시트 전체 덮어쓰기
async function overwriteSheet(sheets, sheetName, rows) {
  // 먼저 기존 내용 지우기
  await sheets.spreadsheets.values.clear({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  // 새 데이터 쓰기
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

// 헤더가 없으면 첫 행에 헤더 추가
async function ensureHeaders(sheets, sheetName, headers) {
  const existing = await readSheet(sheets, sheetName);
  if (existing.length === 0) {
    await appendRows(sheets, sheetName, [headers]);
    console.log(`  헤더 추가됨: ${sheetName}`);
  }
}

// ── raw_snapshots 적재 ─────────────────────────────────────────────────
async function saveRawSnapshots(products) {
  console.log('\n[Sheets] raw_snapshots 저장 중...');
  const sheets = await getSheets();

  // 헤더 확인
  await ensureHeaders(sheets, 'raw_snapshots', RAW_HEADERS);

  // 오늘 날짜 + 카테고리 중복 확인
  const existing = await readSheet(sheets, 'raw_snapshots');
  const today    = products[0]?.snapshot_date;
  const category = products[0]?.category;
  const alreadyExists = existing.slice(1).some(row => row[0] === today && row[3] === category);

  if (alreadyExists) {
    console.log(`  ⚠️  ${today} [${category}] 데이터가 이미 있어요. 중복 저장 건너뜀.`);
    return false;
  }

  // 상품 데이터 → 2차원 배열로 변환
  const rows = products.map(p =>
    RAW_HEADERS.map(key => {
      const val = p[key];
      if (val === null || val === undefined) return '';
      return val;
    })
  );

  await appendRows(sheets, 'raw_snapshots', rows);
  console.log(`  ✅ ${products.length}개 저장 완료 (${today})`);
  return true;
}

// ── daily_changes 적재 ────────────────────────────────────────────────
const DAILY_HEADERS = [
  'snapshot_date', 'product_key', 'brand_key',
  'today_rank', 'yesterday_rank', 'rank_change',
  'today_sale_price', 'yesterday_sale_price', 'price_change', 'price_change_rate',
  'is_new_entry', 'is_reentry', 'is_price_changed',
];

async function saveDailyChanges(changes) {
  console.log('\n[Sheets] daily_changes 저장 중...');
  const sheets = await getSheets();
  await ensureHeaders(sheets, 'daily_changes', DAILY_HEADERS);

  const today = changes[0]?.snapshot_date;

  // 오늘 날짜 중복 확인
  const existing = await readSheet(sheets, 'daily_changes');
  if (existing.slice(1).some(row => row[0] === today)) {
    console.log(`  ⚠️  ${today} 이미 있어요. 건너뜀.`);
    return;
  }

  const rows = changes.map(c => DAILY_HEADERS.map(k => c[k] ?? ''));
  await appendRows(sheets, 'daily_changes', rows);
  console.log(`  ✅ ${changes.length}개 저장 완료`);
}

// ── brand_entries 적재 ────────────────────────────────────────────────
const BRAND_HEADERS = [
  'snapshot_date', 'brand_key', 'brand_name_raw',
  'is_new_entry', 'is_reentry', 'entry_rank',
];

async function saveBrandEntries(entries) {
  console.log('\n[Sheets] brand_entries 저장 중...');
  const sheets = await getSheets();
  await ensureHeaders(sheets, 'brand_entries', BRAND_HEADERS);

  if (entries.length === 0) {
    console.log('  신규 진입 브랜드 없음');
    return;
  }

  const rows = entries.map(e => BRAND_HEADERS.map(k => e[k] ?? ''));
  await appendRows(sheets, 'brand_entries', rows);
  console.log(`  ✅ ${entries.length}개 브랜드 기록됨`);
}

// ── 키워드 검색 시트 초기 설정 ─────────────────────────────────────────
async function setupKeywordSearchSheet() {
  const sheets = await getSheets();
  const spreadsheetId = process.env.SPREADSHEET_ID;

  // 시트가 이미 존재하면 스킵
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === '키워드 검색');
  if (exists) {
    console.log('[Sheets] 키워드 검색 시트 이미 존재 — 스킵');
    return;
  }

  // 새 시트 추가
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: '키워드 검색' } } }],
    },
  });

  // 제품별 요약: 브랜드·제품명으로 그룹핑, 평균 순위 오름차순
  const summaryFormula =
    `=IFERROR(QUERY(raw_snapshots!A:P,` +
    `"SELECT G, F, AVG(E), MIN(E), MAX(E), AVG(I), MIN(I), MAX(I), COUNT(A), MIN(A), MAX(A) ` +
    `WHERE (F CONTAINS '"&B2&"' OR G CONTAINS '"&B2&"') AND F <> 'product_name_raw' ` +
    `GROUP BY G, F ORDER BY AVG(E) ASC ` +
    `LABEL G '브랜드', F '제품명', AVG(E) '평균 순위', MIN(E) '최고 순위', MAX(E) '최저 순위', ` +
    `AVG(I) '평균 판매가', MIN(I) '최저가', MAX(I) '최고가', COUNT(A) '노출 횟수', MIN(A) '첫 등장', MAX(A) '마지막 등장'",0),` +
    `"검색 결과가 없습니다")`;

  // 전체 기록: 날짜 최신순, 같은 날엔 순위 오름차순
  const detailFormula =
    `=IFERROR(QUERY(raw_snapshots!A:P,` +
    `"SELECT A, D, E, G, F, I, H, K ` +
    `WHERE (F CONTAINS '"&B2&"' OR G CONTAINS '"&B2&"') AND F <> 'product_name_raw' ` +
    `ORDER BY A DESC, E ASC ` +
    `LABEL A '날짜', D '카테고리', E '순위', G '브랜드', F '제품명', I '판매가', H '정가', K '할인율'",0),` +
    `"검색 결과가 없습니다")`;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        {
          range: '키워드 검색!A1:B2',
          values: [
            ['🔍 키워드 검색', ''],
            ['검색어 입력 →', ''],  // B2 셀에 직접 입력 (예: 앰플)
          ],
        },
        { range: '키워드 검색!A4', values: [['📊 제품별 요약 (평균 순위 오름차순)']] },
        { range: '키워드 검색!A5', values: [[summaryFormula]] },
        { range: '키워드 검색!A18', values: [['📋 전체 기록 (최신순)']] },
        { range: '키워드 검색!A19', values: [[detailFormula]] },
      ],
    },
  });

  console.log('[Sheets] ✅ 키워드 검색 시트 생성 완료');
}

module.exports = {
  getSheets, readSheet, appendRows, overwriteSheet,
  saveRawSnapshots, saveDailyChanges, saveBrandEntries,
  setupKeywordSearchSheet,
};
