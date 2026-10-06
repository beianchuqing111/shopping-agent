export function formatPrice(cents) { return `¥${(cents / 100).toFixed(2)}`; }

export function formatInt(cents) { return `¥${Math.round(cents / 100)}`; }

export function discountPercent(price, listPrice) {
  if (!listPrice || listPrice <= price) return null;
  return Math.round((1 - price / listPrice) * 100);
}

export function formatCount(value) {
  const n = Number(value) || 0;
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n);
}

export function formatRating(rating) {
  return (Number(rating) || 0).toFixed(1);
}

export function orderStatusText(status) {
  return {
    pending_payment: '待支付',
    paid: '已支付',
    shipped: '已发货',
    completed: '已完成',
    cancelled: '已取消',
  }[status] || status;
}

export function validateAddress(address) {
  const errors = {};
  if (!address.recipient || address.recipient.trim().length < 2) errors.recipient = '请填写收货人姓名（至少 2 个字）';
  if (!/^\d{6,20}$/.test((address.phone || '').replace(/[\s-]/g, ''))) errors.phone = '请填写数字手机号';
  if (!address.detail || address.detail.trim().length < 5) errors.detail = '请填写详细地址（含省市与门牌）';
  return errors;
}
