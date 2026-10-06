import {newPage, setInput} from './cdp.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:58123';
const out = {step: 'checkout', checks: [], shots: []};
const check = (name, value) => {
  out.checks.push({name, value});
  console.log(`- ${name}: ${JSON.stringify(value)}`);
};

const page = await newPage();
const errors = [];
page.ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
});

try {
  await page.goto(BASE + '/', 1500);
  await page.evalJs("localStorage.clear()");
  await page.goto(BASE + '/#/p/kbd-001', 2200);
  check('product loaded', await page.evalJs("document.querySelector('.buy-box h1')?.textContent.trim()"));
  await page.evalJs("document.querySelector('.buy-actions .btn-primary').click()");
  await page.waitFor("Number(document.querySelector('.cart-badge')?.textContent || 0) >= 1", 6000);

  // 购物车
  await page.goto(BASE + '/#/cart', 1800);
  check('cart dom', await page.evalJs(`(() => ({
    rows: document.querySelectorAll('.cart-table tbody tr').length,
    total: document.querySelector('.summary-row.total strong')?.textContent.trim(),
    shipping: [...document.querySelectorAll('.summary-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim()),
    tip: document.querySelector('.ship-tip')?.textContent.trim() || null
  }))()`));
  out.shots.push(await page.shot('06-cart'));

  // 结算
  await page.goto(BASE + '/#/checkout', 1800);
  check('checkout before fill', await page.evalJs(`(() => ({
    fields: [...document.querySelectorAll('.checkout-form .field')].map(l => l.textContent.trim().split('\\n')[0]),
    items: document.querySelectorAll('.confirm-list li').length,
    total: document.querySelector('.checkout-side .summary-row.total strong')?.textContent.trim()
  }))()`));

  await page.evalJs(setInput('.checkout-form input[placeholder="姓名"]', '张罡瑞'));
  await page.evalJs(setInput('.checkout-form input[placeholder="11 位手机号"]', '13800001234'));
  await page.evalJs(setInput('.checkout-form textarea', '广东省广州市天河区科韵路 16 号 1201 室'));
  await page.evalJs(setInput('.checkout-form input[placeholder="510000"]', '510630'));
  out.shots.push(await page.shot('07-checkout-filled'));

  // 空地址校验：先清空姓名再提交，应出现行内错误
  await page.evalJs(setInput('.checkout-form input[placeholder="姓名"]', ''));
  await page.evalJs("document.querySelector('.checkout-side button[type=submit]').click()");
  await new Promise((r) => setTimeout(r, 600));
  check('validation error', await page.evalJs("document.querySelector('.field-error')?.textContent.trim()"));
  out.shots.push(await page.shot('08-checkout-validation'));

  await page.evalJs(setInput('.checkout-form input[placeholder="姓名"]', '张罡瑞'));
  await page.evalJs("document.querySelector('.checkout-side button[type=submit]').click()");
  await page.waitFor("location.hash.startsWith('#/order/')", 15000);
  await new Promise((r) => setTimeout(r, 1200));

  check('order created', await page.evalJs(`(() => ({
    hash: location.hash.slice(0, 20),
    orderNo: document.querySelector('.order-no')?.textContent.trim(),
    status: document.querySelector('.status')?.textContent.trim(),
    steps: [...document.querySelectorAll('.timeline li')].map(li => li.querySelector('strong').textContent.trim()),
    address: [...document.querySelectorAll('.address dd')].map(d => d.textContent.trim()),
    total: document.querySelector('.summary-row.total strong')?.textContent.trim(),
    items: [...document.querySelectorAll('.table tbody tr td:nth-child(2)')].map(td => td.textContent.trim())
  }))()`));
  out.shots.push(await page.shot('09-order-pending'));

  // 模拟支付
  await page.evalJs("[...document.querySelectorAll('.order-actions .btn')].find(b => b.textContent.includes('模拟支付')).click()");
  await page.waitFor("document.querySelector('.status')?.textContent.includes('已支付')", 15000);
  await new Promise((r) => setTimeout(r, 800));
  check('after pay', await page.evalJs(`(() => ({
    status: document.querySelector('.status')?.textContent.trim(),
    notice: document.querySelector('.state.notice')?.textContent.trim(),
    doneSteps: [...document.querySelectorAll('.timeline li.done strong')].map(e => e.textContent.trim())
  }))()`));
  out.shots.push(await page.shot('10-order-paid'));

  // 订单列表
  await page.goto(BASE + '/#/orders', 1800);
  check('order list', await page.evalJs(`(() => ({
    count: document.querySelectorAll('.order-list > li').length,
    firstStatus: document.querySelector('.order-list .status')?.textContent.trim(),
    firstTotal: document.querySelector('.order-foot strong')?.textContent.trim()
  }))()`));
  out.shots.push(await page.shot('11-orders'));

  check('exceptions', errors);
} finally {
  page.close();
}

fs.writeFileSync(new URL('./results-checkout.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('shots:', out.shots.join(', '));
