import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discountPercent, formatCount, formatPrice, orderStatusText, validateAddress} from '../src/format.js';
import {addItem, cartCount, cartShipping, cartSubtotal, cartTotal, removeItem, setQuantity, toOrderItems} from '../src/cart.js';
import {parseHash} from '../src/router.js';

const phone = (overrides = {}) => ({recipient: '张三', phone: '13800000000', detail: '广东省广州市天河区某某路 1 号', ...overrides});

test('整数分渲染为人民币价格', () => {
  assert.equal(formatPrice(9900), '¥99.00');
  assert.equal(formatPrice(0), '¥0.00');
});

test('折扣与销量格式化', () => {
  assert.equal(discountPercent(9900, 14900), 34);
  assert.equal(discountPercent(9900, 9900), null);
  assert.equal(formatCount(3620), '3620');
  assert.equal(formatCount(12000), '1.2万');
});

test('订单状态文案与地址校验', () => {
  assert.equal(orderStatusText('pending_payment'), '待支付');
  assert.equal(orderStatusText('shipped'), '已发货');
  assert.deepEqual(validateAddress(phone()), {});
  assert.ok(validateAddress(phone({phone: 'abc'})).phone);
  assert.ok(validateAddress(phone({detail: '短'})).detail);
  assert.ok(validateAddress(phone({recipient: ''})).recipient);
});

const product = {id: 'p1', title: '测试商品', sku: 'T-1', price_cents: 5000, stock: 3};

test('购物车增删改与库存上限', () => {
  let cart = addItem([], product, 2);
  assert.equal(cartCount(cart), 2);
  cart = addItem(cart, product, 5);
  assert.equal(cart[0].quantity, 3, '不超过库存');
  cart = setQuantity(cart, 'p1', 0);
  assert.deepEqual(cart, [], '数量减到 0 即移除');
  cart = addItem([], product);
  cart = addItem(cart, {id: 'p2', title: '第二件', price_cents: 1000, stock: 1});
  assert.equal(cartSubtotal(cart), 6000);
  cart = removeItem(cart, 'p1');
  assert.equal(cart.length, 1);
});

test('运费规则：满 ¥99 包邮，否则 ¥10', () => {
  const small = addItem([], {id: 'a', title: 'a', price_cents: 2900, stock: 5});
  assert.equal(cartShipping(small), 1000);
  assert.equal(cartTotal(small), 3900);
  const big = addItem([], {id: 'b', title: 'b', price_cents: 9900, stock: 5});
  assert.equal(cartShipping(big), 0);
  assert.equal(cartTotal(big), 9900);
  assert.equal(cartShipping([]), 0);
});

test('下单载荷只包含商品与数量', () => {
  const cart = addItem([], product, 2);
  assert.deepEqual(toOrderItems(cart), [{product_id: 'p1', quantity: 2}]);
});

test('hash 路由解析', () => {
  assert.equal(parseHash('').name, 'home');
  assert.equal(parseHash('#/').name, 'home');
  assert.deepEqual(parseHash('#/p/hp-002'), {path: 'p/hp-002', query: {}, name: 'product', id: 'hp-002'});
  assert.equal(parseHash('#/c/keyboard').category, 'keyboard');
  assert.equal(parseHash('#/s?q=%E8%80%B3%E6%9C%BA').search, '耳机');
  assert.equal(parseHash('#/order/abc').id, 'abc');
  assert.equal(parseHash('#/nope').name, 'notfound');
});
