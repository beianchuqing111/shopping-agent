import {newPage, setInput} from './cdp.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:58123';
const TOKEN = process.env.ADMIN_TOKEN || 'local-demo-admin';
const out = {step: 'support-widget', checks: [], shots: []};
const check = (name, value) => {
  out.checks.push({name, value});
  console.log(`- ${name}: ${JSON.stringify(value)}`);
};

const page = await newPage();
const errors = [];
page.ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
});

const send = async (text) => {
  await page.evalJs(setInput('.support-composer input', text));
  await page.evalJs("document.querySelector('.support-composer button').click()");
};

const lastAgent = `(() => {
  const messages = [...document.querySelectorAll('.support-body .message.assistant p')];
  return messages.length ? messages[messages.length - 1].textContent.trim() : null;
})()`;

try {
  await page.goto(BASE + '/', 2200);
  await page.evalJs("localStorage.clear()");
  await page.goto(BASE + '/', 2200);

  check('launcher visible', await page.evalJs(`(() => {
    const el = document.querySelector('.support-launcher');
    const style = el ? getComputedStyle(el) : null;
    return el ? {text: el.textContent.trim(), position: style.position, right: style.right, bottom: style.bottom, visible: style.display !== 'none'} : null;
  })()`));
  out.shots.push(await page.shot('19-support-closed'));

  await page.evalJs("document.querySelector('.support-launcher').click()");
  await page.waitFor("!!document.querySelector('.support-panel')", 6000);
  await new Promise((r) => setTimeout(r, 500));
  check('panel opened', await page.evalJs(`(() => ({
    title: document.querySelector('.support-title strong')?.textContent.trim(),
    subtitle: document.querySelector('.support-title small')?.textContent.trim(),
    greeting: document.querySelector('.support-body .message p')?.textContent.trim().slice(0, 40),
    chips: [...document.querySelectorAll('.support-chips .chip')].map(c => c.textContent.trim()),
    box: (() => { const r = document.querySelector('.support-panel').getBoundingClientRect(); return {right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), width: Math.round(r.width)}; })()
  }))()`));
  out.shots.push(await page.shot('20-support-open'));

  // 快捷问题：运费
  await page.evalJs("[...document.querySelectorAll('.support-chips .chip')].find(c => c.textContent.includes('运费')).click()");
  await page.waitFor(`(${lastAgent})?.includes('免运费')`, 15000);
  check('faq answer', await page.evalJs(lastAgent));
  check('faq source chip', await page.evalJs("document.querySelector('.support-source')?.textContent.trim()"));
  out.shots.push(await page.shot('21-support-faq'));

  // 订单查询（没有订单时的引导）
  await send('我的订单到哪了？');
  await page.waitFor(`(${lastAgent})?.includes('还没有订单')`, 15000);
  check('order without orders', await page.evalJs(lastAgent));

  // 转人工建工单
  await send('我要转人工，问个你们没有的问题：能不能定制刻字');
  await page.waitFor("[...document.querySelectorAll('.support-source')].some(e => e.textContent.includes('工单'))", 20000);
  check('ticket created in widget', await page.evalJs(`(() => ({
    reply: ${lastAgent},
    ticketChip: [...document.querySelectorAll('.support-source')].map(e => e.textContent.trim()).filter(t => t.includes('工单'))
  }))()`));
  out.shots.push(await page.shot('22-support-ticket'));

  // 商品页上下文：问这件商品（带图片卡片）
  await page.goto(BASE + '/#/p/hp-002', 2200);
  const panelOpen = await page.evalJs("!!document.querySelector('.support-panel')");
  if (!panelOpen) await page.evalJs("document.querySelector('.support-launcher').click()");
  await page.waitFor("!!document.querySelector('.support-panel')", 6000);
  check('context chip on product page', await page.evalJs("[...document.querySelectorAll('.support-chips .chip')].map(c => c.textContent.trim())"));
  await page.evalJs("[...document.querySelectorAll('.support-chips .chip')].find(c => c.textContent.includes('问问这件商品')).click()");
  await page.waitFor("!!document.querySelector('.support-card.product')", 15000);
  await new Promise((r) => setTimeout(r, 600));
  check('product card in chat', await page.evalJs(`(() => ({
    reply: ${lastAgent},
    title: document.querySelector('.support-card.product strong')?.textContent.trim(),
    meta: document.querySelector('.support-card.product small')?.textContent.trim(),
    hasImage: !!document.querySelector('.support-card.product img')?.naturalWidth
  }))()`));
  out.shots.push(await page.shot('23-support-product'));

  // 后台工单页
  await page.goto(BASE + '/#/admin', 2000);
  const needsLogin = await page.evalJs("!!document.querySelector('.admin-login input[type=password]')");
  if (needsLogin) {
    await page.evalJs(setInput('.admin-login input[type=password]', TOKEN));
    await page.evalJs("document.querySelector('.admin-login button[type=submit]').click()");
  }
  await page.waitFor("document.querySelectorAll('.admin-table tbody tr').length > 5", 15000);
  await page.evalJs("[...document.querySelectorAll('.admin-tabs .chip')].find(b => b.textContent.includes('客服工单')).click()");
  await page.waitFor("!!document.querySelector('.admin-table tbody tr')", 10000);
  await new Promise((r) => setTimeout(r, 400));
  check('admin tickets tab', await page.evalJs(`(() => ({
    tabLabel: [...document.querySelectorAll('.admin-tabs .chip')].map(b => b.textContent.trim()).find(t => t.includes('客服工单')),
    rows: document.querySelectorAll('.admin-table tbody tr').length,
    firstRow: [...document.querySelectorAll('.admin-table tbody tr:first-child td')].map(td => td.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 4)
  }))()`));
  out.shots.push(await page.shot('24-admin-tickets'));

  await page.evalJs("document.querySelector('.admin-table tbody tr:first-child .cell-actions button').click()");
  await page.waitFor("document.querySelector('.admin-table tbody tr:first-child .status')?.textContent.includes('已关闭')", 12000);
  check('ticket closed from admin', await page.evalJs(`(() => ({
    status: document.querySelector('.admin-table tbody tr:first-child .status')?.textContent.trim(),
    buttonDisabled: document.querySelector('.admin-table tbody tr:first-child .cell-actions button').disabled
  }))()`));
  out.shots.push(await page.shot('25-admin-ticket-closed'));

  check('page exceptions', errors);
} finally {
  page.close();
}

fs.writeFileSync(new URL('./results-support.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('shots:', out.shots.join(', '));
