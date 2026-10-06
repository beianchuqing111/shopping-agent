import {useEffect, useState} from 'react';
import {api} from '../api.js';
import {Link} from '../link.jsx';
import {ErrorNote, Loading, ProductCard} from '../ui.jsx';
import {discountPercent, formatPrice} from '../format.js';

export default function Home() {
  const [state, setState] = useState({loading: true, error: '', categories: [], best: [], fresh: [], deals: []});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, fresh] = await Promise.all([
          api.products({page_size: 60}),
          api.products({sort: 'new', page_size: 4}),
        ]);
        if (!alive) return;
        setState({
          loading: false,
          error: '',
          categories: list.categories || [],
          best: list.products.slice(0, 8),
          fresh: fresh.products,
          deals: list.products
            .filter((p) => discountPercent(p.price_cents, p.list_price_cents))
            .sort((a, b) => discountPercent(b.price_cents, b.list_price_cents) - discountPercent(a.price_cents, a.list_price_cents))
            .slice(0, 4),
        });
      } catch (error) {
        if (alive) setState((s) => ({...s, loading: false, error: error.message}));
      }
    })();
    return () => { alive = false; };
  }, []);

  const {categories, best, fresh, deals, loading, error} = state;
  const cheapest = best.length ? Math.min(...best.map((p) => p.price_cents)) : 0;

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-tag">自建演示商城 · 全链路可跑通</span>
          <h1>从浏览到发货，一条闭环跑到底</h1>
          <p>
            商品目录、详情、购物车、收货地址、下单、支付、发货、后台管理都已实现；
            数据为自建演示数据，不涉及真实交易与真实品牌报价。
          </p>
          <div className="hero-actions">
            <Link to="/c/headphones" className="btn btn-primary">开始逛耳机</Link>
            <Link to="/s?q=新品" className="btn">搜索商品</Link>
            <Link to="/admin" className="btn btn-ghost">进入管理后台</Link>
          </div>
          <dl className="hero-stats">
            <div><dt>在售商品</dt><dd>{categories.reduce((n, c) => n + c.count, 0)} 件</dd></div>
            <div><dt>商品分类</dt><dd>{categories.length} 个</dd></div>
            <div><dt>起售价</dt><dd>{cheapest ? formatPrice(cheapest) : '—'}</dd></div>
            <div><dt>支付</dt><dd>演示（不扣真钱）</dd></div>
          </dl>
        </div>
        <div className="hero-art">
          <img src="/api/products/hp-002/images/1.svg" alt="商品示意图"/>
          <img src="/api/products/kbd-004/images/2.svg" alt="商品示意图"/>
        </div>
      </section>

      <ErrorNote message={error}/>
      {loading ? <Loading/> : null}

      <section className="section">
        <header className="section-head"><h2>商品分类</h2><Link to="/s?q=" className="more">查看全部 →</Link></header>
        <div className="category-grid">
          {categories.map((category) => (
            <Link key={category.key} to={`/c/${category.key}`} className="category-card">
              <strong>{category.name}</strong>
              <small>{category.desc}</small>
              <em>{category.count} 件在售</em>
            </Link>
          ))}
        </div>
      </section>

      {deals.length ? (
        <section className="section deals">
          <header className="section-head"><h2>限时优惠</h2><span className="hint">价格为自建演示数据</span></header>
          <div className="deal-row">
            {deals.map((p) => (
              <Link key={p.id} to={`/p/${p.id}`} className="deal">
                <img src={`/api/products/${p.id}/images/0.svg`} alt={p.title}/>
                <div>
                  <strong>{p.title}</strong>
                  <span className="deal-price">{formatPrice(p.price_cents)}</span>
                  <s>{formatPrice(p.list_price_cents)}</s>
                  <em>-{discountPercent(p.price_cents, p.list_price_cents)}%</em>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <header className="section-head"><h2>热销榜</h2><span className="hint">按累计销量排序</span></header>
        <div className="grid">{best.map((p) => <ProductCard key={p.id} product={p}/>)}</div>
      </section>

      <section className="section">
        <header className="section-head"><h2>最新上架</h2><span className="hint">从新到旧排列的前 4 件</span></header>
        <div className="grid">{fresh.map((p) => <ProductCard key={p.id} product={p}/>)}</div>
      </section>
    </div>
  );
}
