import {useEffect, useRef, useState} from 'react';
import {api, ensureSession} from '../api.js';
import {useCart} from '../store.jsx';
import {Empty, ErrorNote, Loading, Price, ProductCard} from '../ui.jsx';
import {formatPrice} from '../format.js';

const CATEGORY_LABELS = {headphones: '耳机', keyboard: '键盘', mouse: '鼠标', speaker: '音箱', monitor: '显示器', microphone: '麦克风', accessory: '配件'};

export default function Guide() {
  const cart = useCart();
  const [sid, setSid] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [constraints, setConstraints] = useState({});
  const [products, setProducts] = useState([]);
  const [trace, setTrace] = useState([]);
  const [mode, setMode] = useState('');
  const [selected, setSelected] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef(null);

  useEffect(() => { ensureSession().then(setSid).catch((e) => setError(e.message)); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({block: 'nearest'}); }, [messages]);

  async function send(message, explicitConstraints = {}) {
    if (!sid) return;
    setBusy(true);
    setError('');
    setComparison(null);
    try {
      const result = await api.chat(sid, message || '按当前条件查找商品', explicitConstraints);
      setProducts(result.products);
      setTrace(result.tool_trace || []);
      setConstraints(result.constraints || {});
      setMode(result.mode);
      setMessages((current) => [...current, {role: 'user', content: message}, {role: 'assistant', content: result.message}]);
      setSelected([]);
      setInput('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : current.length < 4 ? [...current, id] : current);
  }

  async function compare() {
    setBusy(true);
    try {
      setComparison((await api.compare(sid, selected)).products);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page guide-page">
      <h1>智能导购</h1>
      <p className="hint">
        用自然语言提需求（例如「100 元以内的耳机」「换成鼠标，预算 300」），服务端把话术解析成检索条件，
        命中的商品与工具调用记录都在下面。商品事实来自服务端目录，模型文本不作为商品证据。
      </p>

      <div className="guide-layout">
        <aside className="panel">
          <h2>当前条件</h2>
          <dl className="address">
            <div><dt>分类</dt><dd>{constraints.category ? CATEGORY_LABELS[constraints.category] || constraints.category : '不限'}</dd></div>
            <div><dt>预算上限</dt><dd>{constraints.max_price_cents != null ? formatPrice(constraints.max_price_cents) : '不限'}</dd></div>
            <div><dt>品牌</dt><dd>{constraints.brand || '不限'}</dd></div>
            <div><dt>运行模式</dt><dd>{mode === 'llm-tools' ? 'LLM 工具规划器' : mode === 'deterministic-fallback' ? '模型不可用 · 已降级为确定性检索' : '确定性检索'}</dd></div>
          </dl>

          <form className="quick-filters" onSubmit={(e) => { e.preventDefault(); send('按当前条件查找商品', {category: constraints.category || null, max_price_cents: constraints.max_price_cents ?? null}); }}>
            <label className="field">分类
              <select value={constraints.category || ''} onChange={(e) => setConstraints({...constraints, category: e.target.value || null})}>
                <option value="">全部</option>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">预算 / 元
              <input value={constraints.max_price_cents != null ? constraints.max_price_cents / 100 : ''} onChange={(e) => setConstraints({...constraints, max_price_cents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100)})} inputMode="decimal" placeholder="不限"/>
            </label>
            <button className="btn btn-primary full" type="submit" disabled={busy}>按条件筛选</button>
          </form>

          <h3>目录证据 / 工具记录</h3>
          <div className="trace">
            {trace.length ? trace.map((item, index) => (
              <div key={index}>
                <code>{item.name}</code>
                <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
                {item.result_ids ? <small>命中 {item.result_ids.length} 件</small> : null}
              </div>
            )) : <p>暂无调用记录，发送需求后显示。</p>}
          </div>
        </aside>

        <section className="panel guide-main">
          <div className="messages">
            {messages.length === 0 ? <p className="hint">试试输入「300 元以内的键盘」。</p> : null}
            {messages.map((message, index) => (
              <div key={index} className={`message ${message.role}`}>
                <small>{message.role === 'user' ? '你' : '导购助手'}</small>
                <p>{message.content}</p>
              </div>
            ))}
            <div ref={bottom}/>
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="100元以内的耳机" maxLength={2000} aria-label="购物需求"/>
            <button className="btn btn-primary" type="submit" disabled={busy || !sid}>{busy ? '查询中…' : '发送'}</button>
          </form>

          <ErrorNote message={error}/>
          {mode === 'deterministic-fallback' ? (
            <div className="state notice">
              模型暂不可用，已按你的条件返回确定性检索结果（未使用任何模型生成的商品声明）。
              在环境变量里配置可用的 OPENAI_NEXT_API_KEY / LLM_BASE_URL 后可恢复模型规划。
            </div>
          ) : null}
          {busy && !products.length ? <Loading/> : null}
          {!busy && messages.length > 0 && products.length === 0 ? <Empty title="当前条件没有匹配的商品" hint="放宽预算或换个分类再试。"/> : null}

          {products.length ? (
            <>
              <div className="catalog-head">
                <h2>匹配到 {products.length} 件商品</h2>
                <div>
                  <button className="btn" disabled={!selected.length || busy} onClick={compare}>对比（{selected.length}）</button>
                  <button className="btn btn-primary" disabled={!products.length} onClick={() => products.forEach((p) => cart.add(p, 1))}>全部加入购物车</button>
                </div>
              </div>
              {comparison ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>字段</th>{comparison.map((p) => <th key={p.id}>{p.title}</th>)}</tr></thead>
                    <tbody>
                      {[['价格', (p) => formatPrice(p.price_cents)], ['库存', (p) => p.stock], ['分类', (p) => CATEGORY_LABELS[p.category] || p.category], ['品牌', (p) => p.brand], ['特征', (p) => p.features.join(' / ')], ['评分', (p) => p.rating]].map(([label, value]) => (
                        <tr key={label}><th>{label}</th>{comparison.map((p) => <td key={p.id}>{value(p)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="grid">
                {products.map((product) => (
                  <div key={product.id} className={selected.includes(product.id) ? 'pick selected' : 'pick'}>
                    <ProductCard product={product}/>
                    <label className="compare-check">
                      <input type="checkbox" checked={selected.includes(product.id)} onChange={() => toggle(product.id)}/> 加入对比
                    </label>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
