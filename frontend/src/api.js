import {loadSessionId, saveSessionId} from './cart.js';

async function request(path, {method = 'GET', body, adminToken} = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {detail: text};
  }
  if (!response.ok) {
    const detail = data && typeof data.detail === 'string' ? data.detail : '请求失败，请稍后重试';
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  categories: () => request('/api/categories'),
  products: (params = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined),
    ).toString();
    return request(`/api/products${query ? `?${query}` : ''}`);
  },
  product: (id) => request(`/api/products/${encodeURIComponent(id)}`),
  session: (sid) => request(`/api/sessions/${sid}`),
  newSession: () => request('/api/sessions', {method: 'POST', body: {}}),
  chat: (sid, message, constraints = {}) =>
    request(`/api/sessions/${sid}/chat`, {method: 'POST', body: {message, constraints}}),
  compare: (sid, ids) => request(`/api/sessions/${sid}/compare`, {method: 'POST', body: {ids}}),
  createOrder: (sid, payload) => request(`/api/sessions/${sid}/orders`, {method: 'POST', body: payload}),
  orders: (sid) => request(`/api/sessions/${sid}/orders`),
  order: (sid, id) => request(`/api/sessions/${sid}/orders/${id}`),
  pay: (sid, id) => request(`/api/sessions/${sid}/orders/${id}/pay`, {method: 'POST', body: {}}),
  cancelOrder: (sid, id) => request(`/api/sessions/${sid}/orders/${id}/cancel`, {method: 'POST', body: {}}),
  adminProducts: (token) => request('/api/admin/products', {adminToken: token}),
  adminCreateProduct: (token, payload) =>
    request('/api/admin/products', {method: 'POST', body: payload, adminToken: token}),
  adminUpdateProduct: (token, id, payload) =>
    request(`/api/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
      adminToken: token,
    }),
  adminOrders: (token) => request('/api/admin/orders', {adminToken: token}),
  adminShip: (token, id) =>
    request(`/api/admin/orders/${encodeURIComponent(id)}/ship`, {method: 'POST', body: {}, adminToken: token}),
  adminTickets: (token) => request('/api/admin/tickets', {adminToken: token}),
  adminCloseTicket: (token, id) =>
    request(`/api/admin/tickets/${encodeURIComponent(id)}/close`, {method: 'POST', body: {}, adminToken: token}),
  supportFaq: () => request('/api/support/faq'),
  support: (sid, message) => request(`/api/sessions/${sid}/support`, {method: 'POST', body: {message}}),
  sessionTickets: (sid) => request(`/api/sessions/${sid}/tickets`),
  adminReplyTicket: (token, id, message, close = false) =>
    request(`/api/admin/tickets/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: {message, close},
      adminToken: token,
    }),
  adminConversations: (token) => request('/api/admin/conversations', {adminToken: token}),
};

export async function ensureSession() {
  const existing = loadSessionId();
  if (existing) return existing;
  const {id} = await api.newSession();
  saveSessionId(id);
  return id;
}

export function resetSession() {
  saveSessionId('');
}
