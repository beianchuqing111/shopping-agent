import {newPage, setInput} from './cdp.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:58123';
const TOKEN = process.env.ADMIN_TOKEN || 'local-demo-admin';
const out = {step: 'guide-admin-edit', checks: [], shots: []};
const check = (name, value) => {
  out.checks.push({name, value});
  console.log(`- ${name}: ${JSON.stringify(value)}`);
};
const apiGet = async (path, headers = {}) => {
  const response = await fetch(BASE + path, {headers});
  const text = await response.text();
  return {status: response.status, body: text ? JSON.parse(text) : null};
};

// ---------- 智能导购（模型不可用时必须降级而不是报错） ----------
const guide = await newPage();
try {
  await guide.goto(BASE + '/#/guide', 2000);
  await guide.evalJs(setInput('.composer input', '300元以内的键盘'));
  await guide.evalJs("document.querySelector('.composer button').click()");
  await guide.waitFor("document.querySelectorAll('.card').length > 0", 40000);
  await new Promise((r) => setTimeout(r, 1000));
  check('guide result', await guide.evalJs(`(() => ({
    constraints: [...document.querySelectorAll('.address dd')].map(d => d.textContent.trim()),
    lastMessages: [...document.querySelectorAll('.message')].map(m => m.textContent.trim()).slice(-2),
    cards: document.querySelectorAll('.card').length,
    titles: [...document.querySelectorAll('.card h3')].map(h => h.textContent.trim()),
    trace: document.querySelector('.trace pre')?.textContent.trim().replace(/\\s+/g, ' ') || null,
    fallbackNotice: !!document.querySelector('.state.notice'),
    hardError: document.querySelector('.state.error')?.textContent.trim() || null
  }))()`));
  out.shots.push(await guide.shot('17-guide'));

  await guide.evalJs("document.querySelectorAll('.compare-check input')[0].click()");
  await guide.evalJs("document.querySelectorAll('.compare-check input')[1].click()");
  await guide.evalJs("[...document.querySelectorAll('.catalog-head .btn')].find(b => b.textContent.includes('对比')).click()");
  await guide.waitFor("!!document.querySelector('.guide-main table')", 15000);
  check('compare rows', await guide.evalJs("document.querySelectorAll('.guide-main table tbody tr').length"));
  out.shots.push(await guide.shot('18-guide-compare'));

  // 多轮约束更新
  await guide.evalJs(setInput('.composer input', '预算改成200元'));
  await guide.evalJs("document.querySelector('.composer button').click()");
  await guide.waitFor("document.querySelectorAll('.address dd')[1]?.textContent.includes('200')", 30000);
  check('multi-turn constraint', await guide.evalJs("document.querySelector('.address dd:nth-of-type(1)') ? [...document.querySelectorAll('.address dd')].map(d => d.textContent.trim()) : null"));
} finally {
  guide.close();
}

// ---------- 管理后台：精确按 aria-label 修改价格与库存 ----------
const page = await newPage();
try {
  await page.goto(BASE + '/#/admin', 1800);
  const needsLogin = await page.evalJs("!!document.querySelector('.admin-login input[type=password]')");
  if (needsLogin) {
    await page.evalJs(setInput('.admin-login input[type=password]', TOKEN));
    await page.evalJs("document.querySelector('.admin-login button[type=submit]').click()");
  }
  await page.waitFor("document.querySelectorAll('.admin-table tbody tr').length > 5", 15000);

  const rowId = await page.evalJs("document.querySelector('.admin-table tbody tr .cell-product a').getAttribute('href').replace('#/p/', '')");
  const before = await apiGet('/api/products/' + rowId);
  await page.evalJs(`(() => {
    const el = document.querySelectorAll('.admin-table tbody tr:first-child input.mini')[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '66');
    el.dispatchEvent(new Event('input', {bubbles: true}));
    const stock = document.querySelectorAll('.admin-table tbody tr:first-child input.mini')[1];
    setter.call(stock, '11');
    stock.dispatchEvent(new Event('input', {bubbles: true}));
    return [el.value, stock.value];
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  check('draft values', await page.evalJs("[...document.querySelectorAll('.admin-table tbody tr:first-child input.mini')].map(i => i.value)"));
  await page.evalJs("document.querySelector('.admin-table tbody tr:first-child .cell-actions button').click()");
  await page.waitFor("!!document.querySelector('.state.notice')", 12000);
  const after = await apiGet('/api/products/' + rowId);
  check('edit persisted', {
    id: rowId,
    beforePrice: before.body?.product?.price_cents,
    afterPrice: after.body?.product?.price_cents,
    beforeStock: before.body?.product?.stock,
    afterStock: after.body?.product?.stock,
    version: after.body?.product?.version,
  });
  out.shots.push(await page.shot('15-admin-edited'));

  // 发货：先把刚才那笔订单发货
  await page.evalJs("[...document.querySelectorAll('.admin-tabs .chip')].find(b => b.textContent.includes('订单管理')).click()");
  await page.waitFor("document.querySelectorAll('.admin-table tbody tr').length > 0", 10000);
  const shipButton = "document.querySelector('.admin-table tbody tr:first-child .cell-actions button')";
  const disabled = await page.evalJs(`${shipButton}.disabled`);
  if (!disabled) {
    await page.evalJs(`${shipButton}.click()`);
    await page.waitFor("document.querySelector('.admin-table tbody tr:first-child .status')?.textContent.includes('已发货')", 12000);
  }
  check('ship result', await page.evalJs(`(() => ({
    buttonDisabled: ${shipButton}.disabled,
    status: document.querySelector('.admin-table tbody tr:first-child .status')?.textContent.trim()
  }))()`));
  out.shots.push(await page.shot('16-admin-orders'));
} finally {
  page.close();
}

fs.writeFileSync(new URL('./results-guide-admin.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('shots:', out.shots.join(', '));
