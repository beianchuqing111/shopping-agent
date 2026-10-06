import {Link} from '../link.jsx';
import {navigate} from '../router.js';
import {useCart} from '../store.jsx';
import {Empty, Price} from '../ui.jsx';
import {FREE_SHIPPING_CENTS, SHIPPING_CENTS} from '../cart.js';
import {formatPrice} from '../format.js';

export default function Cart() {
  const cart = useCart();

  if (cart.cart.length === 0) {
    return (
      <div className="page">
        <Empty
          title="购物车还是空的"
          hint="去商品列表挑几件吧，满 ¥99 免运费。"
          action={<Link to="/s?q=" className="btn btn-primary">去逛商品</Link>}
        />
      </div>
    );
  }

  const gap = FREE_SHIPPING_CENTS - cart.subtotal;

  return (
    <div className="page cart-page">
      <h1>购物车（{cart.count} 件）</h1>
      <div className="cart-layout">
        <table className="table cart-table">
          <thead>
            <tr><th>商品</th><th>单价</th><th>数量</th><th>小计</th><th/></tr>
          </thead>
          <tbody>
            {cart.cart.map((item) => (
              <tr key={item.product_id}>
                <td className="cell-product">
                  <img src={`/api/products/${item.product_id}/images/0.svg`} alt=""/>
                  <div>
                    <Link to={`/p/${item.product_id}`}>{item.title}</Link>
                    <small>SKU {item.sku} · 库存 {item.stock}</small>
                  </div>
                </td>
                <td>{formatPrice(item.price_cents)}</td>
                <td>
                  <div className="qty small">
                    <button onClick={() => cart.setQuantity(item.product_id, item.quantity - 1)} aria-label="减少">−</button>
                    <input value={item.quantity} onChange={(e) => cart.setQuantity(item.product_id, Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label="数量"/>
                    <button onClick={() => cart.setQuantity(item.product_id, item.quantity + 1)} aria-label="增加">＋</button>
                  </div>
                </td>
                <td className="cell-total">{formatPrice(item.price_cents * item.quantity)}</td>
                <td><button className="link-danger" onClick={() => cart.remove(item.product_id)}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>

        <aside className="cart-summary">
          <h2>订单摘要</h2>
          <div className="summary-row"><span>商品小计</span><span>{formatPrice(cart.subtotal)}</span></div>
          <div className="summary-row"><span>运费</span><span>{cart.shipping === 0 ? '免运费' : formatPrice(cart.shipping)}</span></div>
          {gap > 0 ? (
            <p className="ship-tip">再买 {formatPrice(gap)} 可免运费（当前运费 {formatPrice(SHIPPING_CENTS)}）</p>
          ) : null}
          <div className="summary-row total"><span>应付合计</span><strong>{formatPrice(cart.total)}</strong></div>
          <button className="btn btn-primary btn-lg full" onClick={() => navigate('/checkout')}>去结算</button>
          <Link to="/s?q=" className="btn full">继续购物</Link>
          <p className="disclaimer">演示订单不会真实扣款，也不会真实发货。</p>
        </aside>
      </div>
    </div>
  );
}
