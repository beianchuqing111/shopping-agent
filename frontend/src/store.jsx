import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {
  addItem as addToCart,
  cartCount,
  cartShipping,
  cartSubtotal,
  cartTotal,
  loadCart,
  removeItem as removeFromCart,
  saveCart,
  setQuantity,
  toOrderItems,
} from './cart.js';

const CartContext = createContext(null);

export function CartProvider({children}) {
  const [cart, setCart] = useState(() => loadCart());
  const [flash, setFlash] = useState('');

  useEffect(() => { saveCart(cart); }, [cart]);
  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(''), 2600);
    return () => clearTimeout(timer);
  }, [flash]);

  const add = useCallback((product, quantity = 1) => {
    setCart((current) => addToCart(current, product, quantity));
    setFlash(`已加入购物车：${product.title}`);
  }, []);

  const value = useMemo(() => ({
    cart,
    flash,
    setFlash,
    add,
    setQuantity: (id, quantity) => setCart((c) => setQuantity(c, id, quantity)),
    remove: (id) => setCart((c) => removeFromCart(c, id)),
    clear: () => setCart([]),
    count: cartCount(cart),
    subtotal: cartSubtotal(cart),
    shipping: cartShipping(cart),
    total: cartTotal(cart),
    orderItems: toOrderItems(cart),
  }), [cart, flash, add]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
