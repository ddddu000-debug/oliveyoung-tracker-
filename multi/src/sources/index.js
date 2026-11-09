module.exports = {
  musinsa:   require('./musinsa'),
  oy_global: require('./oy_global'),
  // oy_kr: 기존 트래커가 수집한 raw_snapshots 를 backfill-oy-kr.js 로 복사해 쓴다 (중복 수집 방지).
  //        기존 트래커가 멈추면 --platform=oy_kr 로 직접 수집 가능하도록 어댑터는 남겨둔다.
  oy_kr:     require('./oy_kr'),
  // amazon_us: 보류
};
