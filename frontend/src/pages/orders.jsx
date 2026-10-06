import {useEffect, useState} from 'react';
import {api, ensureSession} from '../api.js';
import {Link} from '../link.jsx';
import {Empty, ErrorNote, Loading} from '../ui.jsx';
import {formatPrice, orderStatusText} from '../format.js';

export default function Orders() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    ensureSession()
      .then((sid) => api.orders(sid))
      .then((result) => { if (alive) setOrders(result.orders); })
      .catch((e) => { if (alive) { setError(e.message); setOrders([]); } });
    return () => { alive = false; };
  }, []);

  if (orders === null) return <div className="page"><Loading label="正在加载订单…"/></div>;

  return (
    <div className="page">
      <h1>我的订单</h1>
      <ErrorNote message={error}/>
      {orders.length === 0 ? (
        <Empty title="还没有订单" hint="下单后可以在这里查看订单状态、支付与发货进度。" action={<Link to="/s?q=" className="btn btn-primary">去逛商品</Link>}/>
      ) : (
        <ul className="order-list">
          {orders.map((order) => (
            <li key={order.id}>
              <div className="order-head">
                <span className="order-no">订单号 {order.order_no || order.id.slice(0, 8)}</span>
                <span className={`status status-${order.status}`}>{orderStatusText(order.status)}</span>
              </div>
              <ul className="order-items">
                {order.items.map((item) => (
                  <li key={item.product_id}>
                    <img src={`/api/products/${item.product_id}/images/0.svg`} alt=""/>
                    <Link to={`/p/${item.product_id}`}>{item.title}</Link>
                    <span>{item.quantity} 件</span>
                  </li>
                ))}
              </ul>
              <div className="order-foot">
                <span>合计 <strong>{formatPrice(order.total_cents)}</strong></span>
                <Link to={`/order/${order.id}`} className="btn btn-primary">查看详情</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
