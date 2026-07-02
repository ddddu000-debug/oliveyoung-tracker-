// 수집할 카테고리 목록
// singlePage: true → 1페이지에 100개 전부 로드 (바디케어 등)
// singlePage: false → 24개씩 여러 페이지 (스킨케어 등)

const CATEGORIES = [
  {
    name:       'skincare',
    label:      '스킨케어',
    singlePage: true,   // 한 페이지에 100개 전부 있음
    // 기존엔 getMCategoryList(dispCatNo=100000100010013)를 썼는데 이는 "스킨/토너" 세부
    // 카테고리 목록이라 토너만 나왔음. 실제 스킨케어 판매 랭킹과 다름 → 다른 카테고리와 동일한
    // getBestList 랭킹 엔드포인트(fltDispCatNo=10000010001=스킨케어)로 통일.
    baseUrl:    'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    params:     'dispCatNo=900000100100001&fltDispCatNo=10000010001&pageIdx=1&rowsPerPage=8',
  },
  {
    name:       'bodycare',
    label:      '바디케어',
    singlePage: true,   // 한 페이지에 100개 전부 있음
    baseUrl:    'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    params:     'dispCatNo=900000100100001&fltDispCatNo=10000010003&pageIdx=1&rowsPerPage=8',
  },
  {
    name:       'haircare',
    label:      '헤어케어',
    singlePage: true,
    baseUrl:    'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    params:     'dispCatNo=900000100100001&fltDispCatNo=10000010004&pageIdx=1&rowsPerPage=8',
  },
  {
    name:       'makeup',
    label:      '메이크업',
    singlePage: true,
    baseUrl:    'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    params:     'dispCatNo=900000100100001&fltDispCatNo=10000010002&pageIdx=1&rowsPerPage=8',
  },
  {
    name:       'maskpack',
    label:      '마스크팩',
    singlePage: true,
    baseUrl:    'https://www.oliveyoung.co.kr/store/main/getBestList.do',
    params:     'dispCatNo=900000100100001&fltDispCatNo=10000010009&pageIdx=1&rowsPerPage=8',
  },
];

module.exports = { CATEGORIES };
