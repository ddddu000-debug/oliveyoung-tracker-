// 사이트 내부 JSON 의 상품 객체를 공통 형식으로 바꾼다.
// 사이트마다 키 이름이 달라 후보 키를 넓게 둔다. discover 결과로 실제 키를 확인한 뒤 좁혀 나간다.
const { pick } = require('../lib/browser');
const { parseNum, discountRate } = require('../lib/util');

const str = v => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : null);
const P = (...keys) => keys.flatMap(k => [k, `info.${k}`, `product.${k}`, `goods.${k}`, `item.${k}`]);

function mapItem(o, { currency, urlFor } = {}) {
  const product_id = pick(o, P('goodsNo', 'prdtNo', 'productNo', 'productId', 'goodsId', 'prdtCd', 'id', 'asin'));
  const sale  = parseNum(pick(o, P('finalPrice', 'salePrice', 'dcPrice', 'sellPrice', 'price', 'nowPrice')));
  const list  = parseNum(pick(o, P('normalPrice', 'originalPrice', 'orgPrice', 'listPrice', 'consumerPrice', 'regularPrice'))) ?? sale;
  const rate  = parseNum(pick(o, P('discountRatio', 'discountRate', 'saleRate', 'dcRate')));
  const image = pick(o, P('imageUrl', 'thumbnail', 'thumbnailUrl', 'imgUrl', 'image.url', 'goodsImage'));
  return {
    product_id:    product_id != null ? String(product_id) : null,
    brand_name:    str(pick(o, P('brandName', 'brandNm', 'brand.name', 'brandEngName', 'brand'))),
    product_name:  str(pick(o, P('goodsName', 'goodsNm', 'prdtName', 'productName', 'name', 'title', 'itemName'))),
    currency,
    list_price:    list,
    sale_price:    sale,
    discount_rate: rate != null ? (rate > 1 ? rate / 100 : rate) : discountRate(list, sale),
    rating:        parseNum(pick(o, P('reviewScore', 'rating', 'avgRating', 'starScore', 'reviewAvg', 'review.score', 'review.averageScore'))),
    review_count:  parseNum(pick(o, P('reviewCount', 'reviewCnt', 'totalCount', 'review.count', 'review.totalCount'))),
    product_url:   urlFor && product_id != null ? urlFor(product_id) : pick(o, P('linkUrl', 'url', 'productUrl')),
    image_url:     typeof image === 'string' ? image : null,
    badges:        [],
    raw:           o,
  };
}

module.exports = { mapItem };
