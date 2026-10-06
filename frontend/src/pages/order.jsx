import {useCallback, useEffect, useState} from 'react';
import {api, ensureSession} from '../api.js';
import {Link} from '../link.jsx';
import {navigate} from '../router.js';
import {ErrorNote, Loading} from '../ui.jsx';
import {formatPrice, orderStatusText} from '../format.js';

const STEPS = ['pending_payment', 'paid', 'shipped', 'completed'];

export default function Order({id}) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const sid = await ensureSession();
      setOrder(await api.order(sid, id));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function act(action, message) {
    setBusy(true);
    setError('');
    try {
      const sid = await ensureSession();
      const result = await action(sid, id);
      setOrder(result.order || result);
      setNotice(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !order) {
    return (
      <div className="page">
        <ErrorNote message={error}/>
        <p><Link to="/orders" className="btn">返回订单列表</Link></p>
      </div>
    );
  }
  if (!order) return <div className="page"><Loading label="正在加载订单…"/></div>;

  const stepIndex = STEPS.indexOf(order.status);

  return (
    <div className="page order-page">
      <h1>订单详情</h1>
      <ErrorNote message={error}/>
      {notice ? <div className="state notice">{notice}</div> : null}

      <div className="order-cards">
        <section className="panel">
          <div className="order-head">
            <span className="order-no">订单号 {order.order_no || order.id}</span>
            <span className={`status status-${order.status}`}>{orderStatusText(order.status)}</span>
          </div>
          {order.status !== 'cancelled' ? (
            <ol className="timeline">
              {STEPS.map((step, index) => (
                <li key={step} className={index <= stepIndex ? 'done' : ''}>
                  <span className="dot"/>
                  <div>
                    <strong>{orderStatusText(step)}</strong>
                    <small>
                      {order.history?.find((h) => h.status === step)?.note || '等待处理'}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="cancelled-note">该订单已取消，库存不做扣减。</p>}

          <div className="order-actions">
            {order.status === 'pending_payment' ? (
              <>
                <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => act(api.pay, '演示支付成功，订单已扣减库存。')}>
                  模拟支付 {formatPrice(order.total_cents)}
                </button>
                <button className="btn" disabled={busy} onClick={() => act(api.cancelOrder, '订单已取消。')}>取消订单</button>
              </>
            ) : null}
            {order.status === 'shipped' ? (
              <button className="btn" disabled={busy} onClick={() => act(api.pay, '订单已确认收货（演示）。')}>确认收货（演示）</button>
            ) : null}
            <Link to="/orders" className="btn">返回订单列表</Link>
            <Link to="/s?q=" className="btn">继续购物</Link>
          </div>
        </section>

        <aside className="panel">
          <h2>收货信息</h2>
          {order.address ? (
            <dl className="address">
              <div><dt>收货人</dt><dd>{order.address.recipient}</dd></div>
              <div><dt>手机号</dt><dd>{order.address.phone}</dd></div>
              <div><dt>地址</dt><dd>{order.address.detail}</dd></div>
              {order.address.postcode ? <div><dt>邮编</dt><dd>{order.address.postcode}</dd></div> : null}
            </dl>
          ) : <p className="hint">该订单未填写收货信息（早期接口创建的订单）。</p>}
          <h2>金额</h2>
          <div className="summary-row"><span>商品小计</span><span>{formatPrice(order.subtotal_cents ?? order.total_cents)}</span></div>
          <div className="summary-row"><span>运费</span><span>{order.shipping_cents ? formatPrice(order.shipping_cents) : '免运费'}</span></div>
          <div className="summary-row total"><span>实付</span><strong>{formatPrice(order.total_cents)}</strong></div>
          <p className="disclaimer">演示订单：支付为模拟操作，不会真实扣款，也不会真实发货。</p>
        </aside>
      </div>

      <section className="panel">
        <h2>商品清单</h2>
        <table className="table">
          <thead><tr><th>商品</th><th>SKU</th><th>单价</th><th>数量</th><th>小计</th></tr></thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.product_id}>
                <td className="cell-product">
                  <img src={`/api/products/${item.product_id}/images/0.svg`} alt=""/>
                  <Link to={`/p/${item.product_id}`}>{item.title}</Link>
                </td>
                <td>{item.sku || '—'}</td>
                <td>{formatPrice(item.unit_price_cents)}</td>
                <td>{item.quantity}</td>
                <td>{formatPrice(item.line_total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
