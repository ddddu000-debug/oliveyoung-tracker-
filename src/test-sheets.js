const { google } = require('googleapis');
require('dotenv').config();

async function testConnection() {
  try {
    console.log('Google Sheets 연결 테스트 중...');

    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
    });

    console.log('✅ 연결 성공!');
    console.log('스프레드시트 이름:', res.data.properties.title);
    console.log('시트 목록:');
    res.data.sheets.forEach(s => {
      console.log('  -', s.properties.title);
    });

  } catch (err) {
    console.error('❌ 연결 실패:', err.message);
  }
}

testConnection();
