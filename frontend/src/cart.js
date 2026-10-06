const SESSION_KEY = 'shopping-agent.session';
const CART_KEY = 'shopping-agent.cart';
const ADMIN_KEY = 'shopping-agent.admin-token';

export function loadCart() {
  try {
    const raw = globalThis.localStorage?.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCart(items) {
  try {
    globalThis.localStorage?.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    /* 存储不可用时只在内存里保留购物车 */
  }
}

export function loadAdminToken() {
  try {
    return globalThis.localStorage?.getItem(ADMIN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAdminToken(token) {
  try {
    globalThis.localStorage?.setItem(ADMIN_KEY, token || '');
  } catch {
    /* 忽略 */
  }
}

export function loadSessionId() {
  try {
    return globalThis.localStorage?.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function saveSessionId(id) {
  try {
    globalThis.localStorage?.setItem(SESSION_KEY, id || '');
  } catch {
    /* 忽略 */
  }
}

export function addItem(cart, product, quantity = 1) {
  const limit = Math.max(1, product.stock);
  const existing = cart.find((x) => x.product_id === product.id);
  if (existing) {
    return cart.map((x) =>
      x.product_id === product.id
        ? { ...x, quantity: Math.min(limit, x.quantity + quantity) }
        : x,
    );
  }
  return [
    ...cart,
    {
      product_id: product.id,
      title: product.title,
      sku: product.sku,
      price_cents: product.price_cents,
      stock: product.stock,
      quantity: Math.min(limit, quantity),
    },
  ];
}

export function setQuantity(cart, productId, quantity) {
  return cart
    .map((x) =>
      x.product_id === productId
        ? { ...x, quantity: Math.max(0, Math.min(x.stock, quantity)) }
        : x,
    )
    .filter((x) => x.quantity > 0);
}

export function removeItem(cart, productId) {
  return cart.filter((x) => x.product_id !== productId);
}

export function cartCount(cart) {
  return cart.reduce((sum, x) => sum + x.quantity, 0);
}

export function cartSubtotal(cart) {
  return cart.reduce((sum, x) => sum + x.price_cents * x.quantity, 0);
}

export const FREE_SHIPPING_CENTS = 9900;
export const SHIPPING_CENTS = 1000;

export function cartShipping(cart) {
  const subtotal = cartSubtotal(cart);
  if (subtotal === 0) return 0;
  return subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIPPING_CENTS;
}

export function cartTotal(cart) {
  return cartSubtotal(cart) + cartShipping(cart);
}

export function toOrderItems(cart) {
  return cart.map(({ product_id, quantity }) => ({ product_id, quantity }));
}
