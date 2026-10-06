import {useEffect, useState} from 'react';
import {api} from '../api.js';
import {Link} from '../link.jsx';
import {Empty, ErrorNote, Loading, Pagination, ProductCard} from '../ui.jsx';

const SORTS = [
  {value: 'default', label: '综合排序'},
  {value: 'price_asc', label: '价格从低到高'},
  {value: 'price_desc', label: '价格从高到低'},
  {value: 'rating', label: '评分优先'},
  {value: 'new', label: '新品优先'},
];

const PRICE_RANGES = [
  {label: '全部价格', min: '', max: ''},
  {label: '¥100 以下', min: '', max: 10000},
  {label: '¥100 – ¥500', min: 10000, max: 50000},
  {label: '¥500 – ¥2000', min: 50000, max: 200000},
  {label: '¥2000 以上', min: 200000, max: ''},
];

export default function Catalog({category = '', search = ''}) {
  const [q, setQ] = useState(search);
  const [sort, setSort] = useState('default');
  const [range, setRange] = useState(0);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({products: [], total: 0, page_size: 12, categories: []});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setQ(search); setPage(1); }, [search, category]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const {min, max} = PRICE_RANGES[range];
    api
      .products({q, category, sort, page, page_size: 12, price_min: min, price_max: max})
      .then((result) => { if (alive) setData(result); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q, category, sort, page, range]);

  const current = data.categories.find((c) => c.key === category);

  return (
    <div className="page catalog-page">
      <nav className="crumbs">
        <Link to="/">首页</Link>
        <span>/</span>
        {current ? <strong>{current.name}</strong> : <strong>{q ? `搜索“${q}”` : '全部商品'}</strong>}
      </nav>

      <div className="catalog-layout">
        <aside className="filters">
          <div className="filter-block">
            <h3>商品分类</h3>
            <ul>
              <li><Link to="/s?q=" className={!category ? 'active' : ''}>全部商品</Link></li>
              {data.categories.map((c) => (
                <li key={c.key}>
                  <Link to={`/c/${c.key}`} className={category === c.key ? 'active' : ''}>
                    {c.name} <em>{c.count}</em>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="filter-block">
            <h3>价格区间</h3>
            <ul>
              {PRICE_RANGES.map((r, index) => (
                <li key={r.label}>
                  <button className={range === index ? 'chip active' : 'chip'} onClick={() => { setRange(index); setPage(1); }}>
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="filter-block">
            <h3>排序</h3>
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </aside>

        <section className="catalog-main">
          <form className="search-bar" onSubmit={(e) => { e.preventDefault(); setPage(1); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索商品名、品牌、卖点，例如：降噪 / 机械 / 便携屏" aria-label="搜索商品"/>
            <button className="btn btn-primary" type="submit">搜索</button>
            {q ? <button className="btn" type="button" onClick={() => { setQ(''); setPage(1); }}>清空</button> : null}
          </form>

          <div className="catalog-head">
            <h1>{current ? current.name : q ? `“${q}” 的搜索结果` : '全部商品'}</h1>
            <span>共 {data.total} 件</span>
          </div>

          <ErrorNote message={error}/>
          {loading ? <Loading/> : null}
          {!loading && !error && data.products.length === 0 ? (
            <Empty title="没有匹配的商品" hint="换个关键词或放宽价格区间试试。"/>
          ) : null}
          <div className="grid">
            {data.products.map((p) => <ProductCard key={p.id} product={p}/>)}
          </div>
          <Pagination page={data.page || page} pageSize={data.page_size || 12} total={data.total} onChange={setPage}/>
        </section>
      </div>
    </div>
  );
}
