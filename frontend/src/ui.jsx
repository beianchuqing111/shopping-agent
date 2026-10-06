import {Link} from './link.jsx';
import {discountPercent, formatCount, formatPrice, formatRating} from './format.js';

export function Stars({rating, reviews}) {
  return (
    <span className="stars" title={`${formatRating(rating)} 分`}>
      <span className="stars-mark">★</span> {formatRating(rating)}
      {reviews ? <small>（{formatCount(reviews)} 条评价）</small> : null}
    </span>
  );
}

export function Price({price, listPrice, size = 'normal'}) {
  const off = discountPercent(price, listPrice);
  return (
    <span className={`price price-${size}`}>
      <strong>{formatPrice(price)}</strong>
      {off ? <s>{formatPrice(listPrice)}</s> : null}
      {off ? <em className="off">省 {off}%</em> : null}
    </span>
  );
}

export function ProductCard({product}) {
  return (
    <article className="card">
      <Link to={`/p/${product.id}`} className="card-art">
        <img src={`/api/products/${product.id}/images/0.svg`} alt={product.title} loading="lazy"/>
        {product.stock === 0 ? <span className="badge badge-out">缺货</span> : null}
        {product.tags?.includes('新品') ? <span className="badge badge-new">新品</span> : null}
        {product.tags?.includes('热销') ? <span className="badge badge-hot">热销</span> : null}
      </Link>
      <div className="card-body">
        <small className="brand-line">{product.brand}</small>
        <h3>
          <Link to={`/p/${product.id}`}>{product.title}</Link>
        </h3>
        <p className="features">{product.features?.join(' · ')}</p>
        <Stars rating={product.rating} reviews={product.reviews}/>
        <Price price={product.price_cents} listPrice={product.list_price_cents}/>
        <div className="card-meta">
          <span>库存 {product.stock}</span>
          <span>已售 {formatCount(product.sold)}</span>
        </div>
      </div>
    </article>
  );
}

export function Pagination({page, pageSize, total, onChange}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="分页">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button>
      <span>第 {page} / {pages} 页 · 共 {total} 件</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</button>
    </nav>
  );
}

export function Loading({label = '加载中…'}) {
  return <p className="state loading">{label}</p>;
}

export function ErrorNote({message, onRetry}) {
  if (!message) return null;
  return (
    <div className="state error" role="alert">
      <span>{message}</span>
      {onRetry ? <button onClick={onRetry}>重试</button> : null}
    </div>
  );
}

export function Empty({title, hint, action}) {
  return (
    <div className="state empty">
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}
