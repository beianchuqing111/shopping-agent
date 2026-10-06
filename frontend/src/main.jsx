import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Link} from './link.jsx';
import {navigate} from './router.js';
import {useRoute} from './hooks.js';
import {CartProvider, useCart} from './store.jsx';
import Home from './pages/home.jsx';
import Catalog from './pages/catalog.jsx';
import Product from './pages/product.jsx';
import Cart from './pages/cart.jsx';
import Checkout from './pages/checkout.jsx';
import Orders from './pages/orders.jsx';
import Order from './pages/order.jsx';
import Guide from './pages/guide.jsx';
import Admin from './pages/admin.jsx';
import SupportWidget from './support.jsx';
import './style.css';

const NAV = [
  {to: '/', label: '首页'},
  {to: '/s?q=', label: '全部商品'},
  {to: '/guide', label: '智能导购'},
  {to: '/orders', label: '我的订单'},
];

function Header() {
  const cart = useCart();
  const [q, setQ] = useState('');
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="logo">
          <span className="logo-mark">选</span>
          <span className="logo-text">选物商城<small>自建演示 · 全链路</small></span>
        </Link>
        <nav className="nav">
          {NAV.map((item) => <Link key={item.label} to={item.to} className="nav-link">{item.label}</Link>)}
        </nav>
        <form className="topbar-search" onSubmit={(e) => { e.preventDefault(); navigate(`/s?q=${encodeURIComponent(q)}`); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索商品" aria-label="搜索商品"/>
          <button type="submit" className="btn btn-sm">搜索</button>
        </form>
        <div className="topbar-actions">
          <Link to="/admin" className="nav-link subtle">管理后台</Link>
          <Link to="/cart" className="cart-link">
            购物车
            {cart.count > 0 ? <em className="cart-badge">{cart.count}</em> : null}
          </Link>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <strong>选物商城（Shopping Agent）</strong>
          <p>自建演示商城：商品数据为原创演示数据，图片为本地生成示意图，不涉及真实品牌报价与真实交易。</p>
        </div>
        <div>
          <strong>功能入口</strong>
          <p>
            <Link to="/s?q=">全部商品</Link> · <Link to="/guide">智能导购</Link> · <Link to="/orders">我的订单</Link> · <Link to="/admin">管理后台</Link>
          </p>
          <p><a href="/docs">API 文档</a> · <a href="/health">健康检查</a></p>
        </div>
      </div>
      <p className="footer-note">支付为模拟操作（不扣真钱），发货为演示流程；生产环境需要接入真实支付渠道与物流服务。</p>
    </footer>
  );
}

function NotFound() {
  return (
    <div className="page">
      <div className="state empty">
        <h3>页面不存在</h3>
        <p>链接可能已失效，回首页继续逛。</p>
        <Link to="/" className="btn btn-primary">返回首页</Link>
      </div>
    </div>
  );
}

function Routes({route}) {
  switch (route.name) {
    case 'home': return <Home/>;
    case 'catalog': return <Catalog category={route.category || ''} search={route.search ?? route.query.q ?? ''}/>;
    case 'product': return <Product id={route.id}/>;
    case 'cart': return <Cart/>;
    case 'checkout': return <Checkout/>;
    case 'orders': return <Orders/>;
    case 'order': return <Order id={route.id}/>;
    case 'guide': return <Guide/>;
    case 'admin': return <Admin/>;
    default: return <NotFound/>;
  }
}

function Toast() {
  const cart = useCart();
  if (!cart.flash) return null;
  return <div className="toast">{cart.flash}</div>;
}

function App() {
  const route = useRoute();
  useEffect(() => {
    const titles = {home: '自建演示电商', catalog: '商品列表', product: '商品详情', cart: '购物车', checkout: '结算', orders: '我的订单', order: '订单详情', guide: '智能导购', admin: '管理后台'};
    document.title = `${titles[route.name] || '选物商城'} · 选物商城`;
  }, [route.name]);
  return (
    <CartProvider>
      <Header/>
      <main className="app-main"><Routes route={route}/></main>
      <Footer/>
      <SupportWidget/>
      <Toast/>
    </CartProvider>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
