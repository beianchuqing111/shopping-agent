import {useEffect, useState} from 'react';
import {api, ensureSession} from '../api.js';
import {Link} from '../link.jsx';
import {navigate} from '../router.js';
import {useCart} from '../store.jsx';
import {Empty, ErrorNote} from '../ui.jsx';
import {formatPrice, validateAddress} from '../format.js';

const EMPTY = {recipient: '', phone: '', detail: '', postcode: ''};

export default function Checkout() {
  const cart = useCart();
  const [address, setAddress] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sid, setSid] = useState('');

  useEffect(() => { ensureSession().then(setSid).catch((e) => setError(e.message)); }, []);

  if (cart.cart.length === 0) {
    return (
      <div className="page">
        <Empty title="购物车为空，无法结算" hint="先挑几件商品再回来。" action={<Link to="/s?q=" className="btn btn-primary">去逛商品</Link>}/>
      </div>
    );
  }

  async function submit(event) {
    event.preventDefault();
    const found = validateAddress(address);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError('');
    try {
      const session = sid || (await ensureSession());
      const result = await api.createOrder(session, {
        request_id: `web-${cart.orderItems.map((i) => `${i.product_id}x${i.quantity}`).join('-')}-${Date.now()}`,
        items: cart.orderItems,
        address: {
          recipient: address.recipient.trim(),
          phone: address.phone.trim(),
          detail: address.detail.trim(),
          postcode: address.postcode.trim() || null,
        },
      });
      cart.clear();
      navigate(`/order/${result.order.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page checkout-page">
      <h1>填写收货信息</h1>
      <form className="checkout-layout" onSubmit={submit}>
        <section className="checkout-form">
          <ErrorNote message={error}/>
          <label className={errors.recipient ? 'field invalid' : 'field'}>
            收货人
            <input value={address.recipient} onChange={(e) => setAddress({...address, recipient: e.target.value})} placeholder="姓名"/>
            {errors.recipient ? <small className="field-error">{errors.recipient}</small> : null}
          </label>
          <label className={errors.phone ? 'field invalid' : 'field'}>
            手机号
            <input value={address.phone} onChange={(e) => setAddress({...address, phone: e.target.value})} placeholder="11 位手机号" inputMode="numeric"/>
            {errors.phone ? <small className="field-error">{errors.phone}</small> : null}
          </label>
          <label className={errors.detail ? 'field invalid' : 'field'}>
            详细地址
            <textarea value={address.detail} onChange={(e) => setAddress({...address, detail: e.target.value})} rows={3} placeholder="省 / 市 / 区 / 街道门牌"/>
            {errors.detail ? <small className="field-error">{errors.detail}</small> : null}
          </label>
          <label className="field">
            邮政编码（可选）
            <input value={address.postcode} onChange={(e) => setAddress({...address, postcode: e.target.value})} placeholder="510000" inputMode="numeric"/>
          </label>
          <p className="disclaimer">提交后订单状态为「待支付」，在订单详情页点击「模拟支付」即可跑通支付与扣库存流程。</p>
        </section>

        <aside className="checkout-side">
          <h2>订单确认</h2>
          <ul className="confirm-list">
            {cart.cart.map((item) => (
              <li key={item.product_id}>
                <img src={`/api/products/${item.product_id}/images/0.svg`} alt=""/>
                <div>
                  <Link to={`/p/${item.product_id}`}>{item.title}</Link>
                  <small>{item.quantity} 件 × {formatPrice(item.price_cents)}</small>
                </div>
                <span>{formatPrice(item.price_cents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="summary-row"><span>商品小计</span><span>{formatPrice(cart.subtotal)}</span></div>
          <div className="summary-row"><span>运费</span><span>{cart.shipping === 0 ? '免运费' : formatPrice(cart.shipping)}</span></div>
          <div className="summary-row total"><span>应付合计</span><strong>{formatPrice(cart.total)}</strong></div>
          <button className="btn btn-primary btn-lg full" type="submit" disabled={busy}>
            {busy ? '正在创建订单…' : '提交订单'}
          </button>
        </aside>
      </form>
    </div>
  );
}
