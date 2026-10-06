export function parseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  const base = {query, path: pathPart};
  if (segments.length === 0) return {...base, name: 'home'};
  const [head, second] = segments;
  if (head === 'c' && second) return {...base, name: 'catalog', category: decodeURIComponent(second)};
  if (head === 's') return {...base, name: 'catalog', search: query.q || ''};
  if (head === 'p' && second) return {...base, name: 'product', id: decodeURIComponent(second)};
  if (head === 'cart') return {...base, name: 'cart'};
  if (head === 'checkout') return {...base, name: 'checkout'};
  if (head === 'orders') return {...base, name: 'orders'};
  if (head === 'order' && second) return {...base, name: 'order', id: decodeURIComponent(second)};
  if (head === 'admin') return {...base, name: 'admin'};
  if (head === 'guide') return {...base, name: 'guide'};
  return {...base, name: 'notfound'};
}

export function navigate(to) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (globalThis.location.hash === target) {
    globalThis.dispatchEvent(new Event('hashchange'));
    return;
  }
  globalThis.location.hash = target;
}
