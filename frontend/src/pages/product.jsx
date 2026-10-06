import {useEffect, useState} from 'react';
import {api} from '../api.js';
import {Link} from '../link.jsx';
import {navigate} from '../router.js';
import {useCart} from '../store.jsx';
import {ErrorNote, Loading, ProductCard, Price, Stars} from '../ui.jsx';
import {formatCount, formatPrice} from '../format.js';

const VIEW_LABELS = ['正面', '四分之三视图', '细节特写'];

export default function Product({id}) {
  const cart = useCart();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(0);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    setView(0);
    setQuantity(1);
    api.product(id)
      .then((result) => { if (alive) setData(result); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id]);

  if (error) {
    return (
      <div className="page">
        <ErrorNote message={error}/>
        <p><Link to="/s?q=" className="btn">返回商品列表</Link></p>
      </div>
    );
  }
  if (!data) return <div className="page"><Loading label="正在加载商品…"/></div>;

  const {product, related, images} = data;
  const soldOut = product.stock === 0;

  return (
    <div className="page product-page">
      <nav className="crumbs">
        <Link to="/">首页</Link><span>/</span>
        <Link to={`/c/${product.category}`}>{product.category}</Link><span>/</span>
        <strong>{product.title}</strong>
      </nav>

      <div className="product-main">
        <div className="gallery">
          <div className="gallery-stage">
            <img src={`/api/products/${product.id}/images/${view}.svg`} alt={`${product.title} ${VIEW_LABELS[view]}`}/>
          </div>
          <div className="gallery-thumbs">
            {Array.from({length: images}).map((_, index) => (
              <button key={index} className={view === index ? 'thumb active' : 'thumb'} onClick={() => setView(index)} aria-label={VIEW_LABELS[index]}>
                <img src={`/api/products/${product.id}/images/${index}.svg`} alt=""/>
                <small>{VIEW_LABELS[index]}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="buy-box">
          <small className="brand-line">{product.brand} · SKU {product.sku}</small>
          <h1>{product.title}</h1>
          <p className="subtitle">{product.description}</p>
          <div className="rate-row">
            <Stars rating={product.rating} reviews={product.reviews}/>
            <span>已售 {formatCount(product.sold)} 件</span>
            <span>库存 {product.stock} 件</span>
          </div>

          <div className="price-panel">
            <Price price={product.price_cents} listPrice={product.list_price_cents} size="large"/>
            <span className="ship-note">
              {product.price_cents >= 9900 ? '包邮（满 ¥99）' : `运费 ¥10，满 ¥99 包邮`}
            </span>
          </div>

          <ul className="feature-list">
            {product.features.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>

          <div className="buy-actions">
            <div className="qty">
              <button onClick={() => setQuantity((n) => Math.max(1, n - 1))} aria-label="减少数量">−</button>
              <input value={quantity} onChange={(e) => {
                const next = Number(e.target.value.replace(/\D/g, '')) || 1;
                setQuantity(Math.min(product.stock || 1, Math.max(1, next)));
              }} aria-label="购买数量"/>
              <button onClick={() => setQuantity((n) => Math.min(product.stock || 1, n + 1))} aria-label="增加数量">＋</button>
            </div>
            <button className="btn btn-primary btn-lg" disabled={soldOut} onClick={() => cart.add(product, quantity)}>
              {soldOut ? '暂时缺货' : '加入购物车'}
            </button>
            <button className="btn btn-outline btn-lg" disabled={soldOut} onClick={() => { cart.add(product, quantity); navigate('/checkout'); }}>
              立即购买
            </button>
          </div>

          <dl className="specs">
            {product.specs.map((spec) => (
              <div key={spec.label}><dt>{spec.label}</dt><dd>{spec.value}</dd></div>
            ))}
            <div><dt>商品编号</dt><dd>{product.sku}</dd></div>
            <div><dt>数据版本</dt><dd>v{product.version}</dd></div>
          </dl>
          <p className="disclaimer">
            本商品为自建演示数据（非真实品牌报价），图片为本地生成的示意图；价格为 CNY {formatPrice(product.price_cents)}。
          </p>
        </div>
      </div>

      <section className="section">
        <header className="section-head"><h2>同类商品</h2><Link to={`/c/${product.category}`} className="more">查看该分类 →</Link></header>
        <div className="grid">{related.map((p) => <ProductCard key={p.id} product={p}/>)}</div>
      </section>
    </div>
  );
}
