import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ShoppingBag, Send, Plus, GitCompareArrows, X, Headphones, Keyboard, Mouse, Database, LoaderCircle, ShoppingCart, Minus, Check} from 'lucide-react';
import {formatPrice} from './format';
import './style.css';

const categories = {headphones:'耳机', keyboard:'键盘', mouse:'鼠标'};
const icons = {headphones:Headphones, keyboard:Keyboard, mouse:Mouse};
async function api(path, body) {
  const response = await fetch(path, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {});
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '条件格式无效，请检查后重试');
  return data;
}
function App() {
  const [sid,setSid] = useState(''); const [products,setProducts] = useState([]); const [messages,setMessages] = useState([]);
  const [category,setCategory] = useState(''); const [budget,setBudget] = useState(''); const [input,setInput] = useState('');
  const [health,setHealth] = useState(null); const [busy,setBusy] = useState(false); const [error,setError] = useState('');
  const [selected,setSelected] = useState([]); const [comparison,setComparison] = useState(null); const [trace,setTrace] = useState([]);
  const [cart,setCart] = useState([]); const [order,setOrder] = useState(null); const [cartOpen,setCartOpen] = useState(false);
  async function newSession() {
    setBusy(true); setError('');
    try { const h = await api('/health'); setHealth(h); const s = await api('/api/sessions', {}); setSid(s.id); setCategory('');setBudget('');setSelected([]);setComparison(null);setMessages([]);setTrace([]);setCart([]);setOrder(null);setCartOpen(false);setProducts((await api('/api/catalog')).products); }
    catch(e){setError(e.message)} finally{setBusy(false)}
  }
  useEffect(()=>{newSession()},[]);
  async function submit(e, filtering=false) {
    e?.preventDefault(); if(!sid || busy) return;
    setBusy(true);setError('');setComparison(null);
    const message = input.trim() || '按当前条件查找商品';
    const constraints = filtering ? {category:category || null,max_price_cents:budget === '' ? null : Math.round(Number(budget)*100)} : {};
    try {const result = await api(`/api/sessions/${sid}/chat`,{message,constraints});setProducts(result.products);setTrace(result.tool_trace);setMessages(m=>[...m,{role:'user',content:message},{role:'assistant',content:result.message}]);setCategory(result.constraints.category || '');setBudget(result.constraints.max_price_cents == null ? '' : String(result.constraints.max_price_cents/100));setSelected([]);setInput('');}
    catch(e){setError(e.message)} finally{setBusy(false)}
  }
  async function compare(){setBusy(true);setError('');try{setComparison((await api(`/api/sessions/${sid}/compare`,{ids:selected})).products)}catch(e){setError(e.message)}finally{setBusy(false)}}
  function toggle(id){setSelected(s=>s.includes(id)?s.filter(x=>x!==id):s.length<4?[...s,id]:s)}
  function addToCart(p){setCart(c=>{const old=c.find(x=>x.product_id===p.id);if(old)return c.map(x=>x.product_id===p.id?{...x,quantity:Math.min(x.quantity+1,p.stock)}:x);return [...c,{product_id:p.id,title:p.title,price_cents:p.price_cents,quantity:1,stock:p.stock}]});setCartOpen(true)}
  function changeQty(id,delta){setCart(c=>c.map(x=>x.product_id===id?{...x,quantity:Math.max(0,Math.min(x.stock,x.quantity+delta))}:x).filter(x=>x.quantity>0))}
  async function checkout(){setBusy(true);setError('');try{const result=await api(`/api/sessions/${sid}/orders`,{request_id:crypto.randomUUID(),items:cart.map(({product_id,quantity})=>({product_id,quantity}))});setOrder(result.order);setCart([]);setCartOpen(false)}catch(e){setError(e.message)}finally{setBusy(false)}}
  const cartTotal=cart.reduce((sum,x)=>sum+x.price_cents*x.quantity,0);
  return <><header><div className="brand"><ShoppingBag size={25}/><span>选物 / Shopping Agent</span></div><span className="source">合成目录 · 非真实报价</span><button title="打开购物车" onClick={()=>setCartOpen(true)}><ShoppingCart size={17}/>购物车 {cart.length>0&&`(${cart.length})`}</button><button title="新建会话" onClick={newSession} disabled={busy}><Plus size={17}/>新会话</button></header>
  <main><aside><div className="section-title"><h2>购物条件</h2><span className="status-dot"/></div><form onSubmit={e=>submit(e,true)}><label>商品类别<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部类别</option>{Object.entries(categories).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><label>最高预算 / 元<input type="number" min="0" max="1000000" step="0.01" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="不限预算"/></label><button className="primary full" disabled={busy || !sid}>筛选商品</button></form><div className="runtime"><Database size={17}/><div><strong>{health?.database || '连接中'}</strong><small>{health?.llm?'LLM 工具规划器':'确定性演示 · 未启用 LLM'}</small></div></div><small className="session">会话 {sid.slice(0,8) || '未连接'}</small><div className="trace"><h3>目录证据 / 工具记录</h3>{trace.length ? trace.map((t,i)=><div key={i}><code>{t.name}</code><pre>{JSON.stringify(t.arguments,null,2)}</pre></div>):<p>synthetic-fixture</p>}</div></aside>
  <section className="catalog"><div className="catalog-head"><div><h1>商品目录</h1><p>{products.length} 件符合条件 · 价格单位 CNY</p></div><button onClick={compare} disabled={busy || selected.length<1}><GitCompareArrows size={17}/>对比 {selected.length>0&&`(${selected.length})`}</button></div>{error&&<div role="alert" className="error">{error}<button title="关闭错误" onClick={()=>setError('')}><X size={16}/></button></div>}
  {comparison?<div className="comparison"><div className="catalog-head"><h2>商品对比</h2><button title="返回目录" onClick={()=>setComparison(null)}><X size={18}/></button></div><div className="table-wrap"><table><thead><tr><th>字段</th>{comparison.map(p=><th key={p.id}>{p.title}</th>)}</tr></thead><tbody>{[['价格',p=>formatPrice(p.price_cents)],['库存',p=>p.stock],['类别',p=>categories[p.category]],['特征',p=>p.features.join(' / ')],['证据',p=>`${p.id} · v${p.version}`]].map(([label,value])=><tr key={label}><th>{label}</th>{comparison.map(p=><td key={p.id}>{value(p)}</td>)}</tr>)}</tbody></table></div></div>:<div className="grid">{products.map(p=>{const Icon=icons[p.category] || ShoppingBag;return <article key={p.id} className={selected.includes(p.id)?'product selected':'product'}><div className={`product-art ${p.category}`}><Icon size={76} strokeWidth={1.1}/><span>DEMO / {p.id}</span></div><div className="product-body"><small>{categories[p.category]} · {p.brand}</small><h2>{p.title}</h2><p>{p.features.join(' · ')}</p><div className="price"><strong>{formatPrice(p.price_cents)}</strong><span>库存 {p.stock}</span></div><label className="compare-check"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)}/>加入对比</label><button onClick={()=>addToCart(p)}><ShoppingCart size={15}/>加入购物车</button><footer>synthetic-fixture · v{p.version}</footer></div></article>})}{products.length===0&&!busy&&<p className="empty">当前条件没有匹配的合成商品。</p>}</div>}
  <div className="conversation"><h2>购物对话</h2><div className="messages" aria-live="polite">{messages.map((m,i)=><div key={i} className={`message ${m.role}`}><small>{m.role==='user'?'你':'目录助手'}</small><p>{m.content}</p></div>)}</div><form onSubmit={submit} className="composer"><input aria-label="购物需求" value={input} onChange={e=>setInput(e.target.value)} placeholder="100元以内的耳机" maxLength={2000}/><button className="primary" title="发送需求" aria-label="发送需求" disabled={busy||!sid}>{busy?<LoaderCircle className="spin" size={19}/>:<Send size={19}/>}</button></form></div>
  </section></main>{order&&<div className="order-success"><Check size={30}/><h2>订单已创建</h2><p>订单号：{order.id}</p><p>当前状态：待支付（演示）</p><strong>合计 {formatPrice(order.total_cents)}</strong><button onClick={()=>setOrder(null)}>返回商品目录</button></div>}{cartOpen&&<div className="cart-drawer"><button className="close" title="关闭购物车" onClick={()=>setCartOpen(false)}><X size={18}/></button><h2>购物车</h2>{cart.length?cart.map(x=><div className="cart-row" key={x.product_id}><div><strong>{x.title}</strong><small>{formatPrice(x.price_cents)}</small></div><div className="qty"><button title="减少" onClick={()=>changeQty(x.product_id,-1)}><Minus size={14}/></button><span>{x.quantity}</span><button title="增加" onClick={()=>changeQty(x.product_id,1)}><Plus size={14}/></button></div></div>):<p>购物车还是空的。</p>}{cart.length>0&&<><div className="cart-total">合计 {formatPrice(cartTotal)}</div><button className="primary full" disabled={busy} onClick={checkout}>创建演示订单</button></>}</div>}<div className="bottom">演示商品、价格、库存均为合成数据 · 无真实支付 · 仅本地演示</div></>;
}
createRoot(document.getElementById('root')).render(<App/>);