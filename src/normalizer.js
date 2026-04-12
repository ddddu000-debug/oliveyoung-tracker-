// 상품명/브랜드명 정규화 및 product_key 생성

// 상품명에서 프로모션 문구 제거
// 예: "[4월 올영픽] 바이오더마 하이드라비오 토너 500ml 기획(+250ml 증정)"
//   → "바이오더마 하이드라비오 토너 500ml"
function normalizeProductName(name) {
  if (!name) return '';
  return name
    .replace(/\[.*?\]/g, '')          // [괄호 안 내용] 제거
    .replace(/\(.*?\)/g, '')          // (괄호 안 내용) 제거
    .replace(/기획|증정|리뉴얼|NEW/g, '') // 프로모션 단어 제거
    .replace(/\s+/g, ' ')             // 연속 공백 → 단일 공백
    .trim();
}

// 브랜드명 정규화
// 예: "바이오더마" → "바이오더마"
function normalizeBrand(brand) {
  if (!brand) return '';
  return brand
    .replace(/\s+/g, '')   // 공백 제거
    .toLowerCase();
}

// product_key 생성: 브랜드 + 정규화된 상품명 조합
// 예: "바이오더마_바이오더마하이드라비오토너500ml"
function makeProductKey(brandRaw, productNameRaw) {
  const brand   = normalizeBrand(brandRaw);
  const product = normalizeProductName(productNameRaw)
    .replace(/\s+/g, '')   // 공백 제거
    .toLowerCase();
  return `${brand}_${product}`;
}

module.exports = { normalizeProductName, normalizeBrand, makeProductKey };
