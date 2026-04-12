// 수집할 카테고리 목록
// singlePage: true → 1페이지에 100개 전부 로드 (바디케어 등)
// singlePage: false → 24개씩 여러 페이지 (스킨케어 등)

const CATEGORIES = [
  {
    name:       'skincare',
    label:      '스킨케어',
    singlePage: false,
    baseUrl:    'https://www.oliveyoung.co.kr/store/display/getMCategoryList.do',
    params:     'dispCatNo=100000100010013&fltDispCatNo=&prdSort=01&rowsPerPage=24&searchTypeSort=btn_thumb&plusButtonFlag=N&isLoginCnt=0&aShowCnt=0&bShowCnt=0&cShowCnt=0&trackingCd=Cat100000100010013_Ranking',
  },
  {
    name:       'bodycare',
    label:      '바디케어',
    singlePage: true,   // 한 페이지에 100개 전부 있음
    baseUrl:    'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    params:     'dispCatNo=900000100100001&fltDispCatNo=10000010003&pageIdx=1&rowsPerPage=8',
  },
];

module.exports = { CATEGORIES };
