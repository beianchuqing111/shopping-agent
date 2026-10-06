import {newPage, setInput} from './cdp.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:58123';
const TOKEN = process.env.ADMIN_TOKEN || 'local-demo-admin';
const out = {step: 'support-widget', checks: [], shots: []};
const check = (name, value) => {
  out.checks.push({name, value});
  console.log(`- ${name}: ${JSON.stringify(value)}`);
};

const json = async (path, options = {}) => {
  const response = await fetch(BASE + path, {
    method: options.method || 'GET',
    headers: {...(options.body ? {'Content-Type': 'application/json'} : {}), ...(options.token ? {'X-Admin-Token': options.token} : {})},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return {status: response.status, body: text ? JSON.parse(text) : null};
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
const panelOpen = () => page.evalJs("!!document.querySelector('.support-panel')");
const openPanel = async () => {
  if (!(await panelOpen())) {
    await page.evalJs("document.querySelector('.support-launcher').click()");
    await page.waitFor("!!document.querySelector('.support-panel')", 6000);
  }
};
const closePanel = async () => {
  if (await panelOpen()) {
    await page.evalJs("document.querySelector('.support-close').click()");
    await page.waitFor("!document.querySelector('.support-panel')", 6000);
  }
};

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

  await openPanel();
  await new Promise((r) => setTimeout(r, 500));
  check('panel opened', await page.evalJs(`(() => ({
    title: document.querySelector('.support-title strong')?.textContent.trim(),
    greeting: document.querySelector('.support-body .message p')?.textContent.trim().slice(0, 40),
    chips: [...document.querySelectorAll('.support-chips .chip')].map(c => c.textContent.trim())
  }))()`));
  out.shots.push(await page.shot('20-support-open'));

  // 知识库回答
  await page.evalJs("[...document.querySelectorAll('.support-chips .chip')].find(c => c.textContent.includes('运费')).click()");
  await page.waitFor(`(${lastAgent})?.includes('免运费')`, 15000);
  check('faq answer', await page.evalJs(lastAgent));
  check('faq source chip', await page.evalJs("document.querySelector('.support-source')?.textContent.trim()"));
  out.shots.push(await page.shot('21-support-faq'));

  // 转人工建工单
  await send('我要转人工，问个你们没有的问题：能不能定制刻字');
  await page.waitFor("[...document.querySelectorAll('.support-source')].some(e => e.textContent.includes('工单'))", 20000);
  const ticketInfo = await page.evalJs(`(() => ({
    reply: ${lastAgent},
    ticketChip: [...document.querySelectorAll('.support-source')].map(e => e.textContent.trim()).filter(t => t.includes('工单'))
  }))()`);
  check('ticket created in widget', ticketInfo);
  out.shots.push(await page.shot('22-support-ticket'));

  // ---------- 新增：最近订单卡片 ----------
  const sid = await page.evalJs("localStorage.getItem('shopping-agent.session')");
  const order = (await json(`/api/sessions/${sid}/orders`, {
    method: 'POST',
    body: {request_id: `e2e-${Date.now()}`, items: [{product_id: 'kbd-003', quantity: 1}], address: {recipient: '张罡瑞', phone: '13800001234', detail: '广东省广州市天河区科韵路 16 号'}},
  })).body.order;
  await page.goto(BASE + '/#/orders', 1800);
  await openPanel();
  await page.waitFor("!!document.querySelector('.support-order-strip')", 10000);
  check('recent order strip', await page.evalJs(`(() => ({
    text: document.querySelector('.support-order-strip')?.textContent.replace(/\\s+/g, ' ').trim(),
    link: document.querySelector('.support-order-link')?.getAttribute('href')
  }))()`));
  out.shots.push(await page.shot('26-support-order-strip'));

  // ---------- 新增：人工回复出现在聊天里 ----------
  const sidTickets = (await json(`/api/sessions/${sid}/tickets`)).body.tickets;
  const ticketId = sidTickets[0].id;
  const staffReply = '收到，可以定制刻字（演示），今天内给你方案。';
  check('admin reply api', (await json(`/api/admin/tickets/${ticketId}/reply`, {method: 'POST', token: TOKEN, body: {message: staffReply}})).status);
  await page.waitFor(`document.body.textContent.includes('可以定制刻字（演示）')`, 25000);
  check('staff reply in widget', await page.evalJs(`(() => ({
    last: ${lastAgent},
    isStaff: !!document.querySelector('.staff-reply'),
    label: [...document.querySelectorAll('.support-body .message small')].slice(-1)[0]?.textContent.trim(),
    ticketNote: [...document.querySelectorAll('.support-source')].map(e => e.textContent.trim()).filter(t => t.includes('人工回复'))
  }))()`));
  out.shots.push(await page.shot('27-support-staff-reply'));

  // ---------- 新增：面板关着时人工回复 → 悬浮球未读角标 ----------
  await closePanel();
  await json(`/api/admin/tickets/${ticketId}/reply`, {method: 'POST', token: TOKEN, body: {message: '补充：刻字工期 2 天，确认后下单备注即可。'}});
  await page.waitFor("!!document.querySelector('.support-unread')", 30000);
  check('unread badge when closed', await page.evalJs("document.querySelector('.support-unread')?.textContent.trim()"));
  out.shots.push(await page.shot('28-support-unread-badge'));
  await openPanel();
  await page.waitFor(`document.body.textContent.includes('刻字工期 2 天')`, 10000);
  check('unread cleared on open', await page.evalJs(`(() => ({
    badge: document.querySelector('.support-unread')?.textContent.trim() || null,
    last: ${lastAgent}
  }))()`));

  // ---------- 后台：工单回复与客服会话查询 ----------
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
    firstRow: [...document.querySelectorAll('.admin-table tbody tr:first-child td')].map(td => td.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 5),
    hasReplyBox: !!document.querySelector('.cell-reply input')
  }))()`));
  out.shots.push(await page.shot('24-admin-tickets'));

  // 从后台界面回复一条
  const replyBox = '.admin-table tbody tr:first-child .cell-reply input';
  await page.evalJs(setInput(replyBox, '这是从管理后台界面发出的回复。'));
  await page.evalJs("document.querySelector('.admin-table tbody tr:first-child .cell-reply button').click()");
  await page.waitFor("!!document.querySelector('.state.notice')", 12000);
  check('reply from admin UI', await page.evalJs("document.querySelector('.state.notice')?.textContent.trim()"));

  await page.evalJs("[...document.querySelectorAll('.admin-tabs .chip')].find(b => b.textContent.includes('客服会话')).click()");
  await page.waitFor("!!document.querySelector('.admin-table tbody tr')", 10000);
  await new Promise((r) => setTimeout(r, 400));
  const shortSid = sid.slice(0, 8);
  check('admin conversations tab', await page.evalJs(`(() => ({
    rows: document.querySelectorAll('.admin-table tbody tr').length,
    firstRow: [...document.querySelectorAll('.admin-table tbody tr:first-child td')].map(td => td.textContent.trim().replace(/\\s+/g, ' ')).slice(0, 4),
    currentSessionListed: [...document.querySelectorAll('.admin-table tbody tr td:first-child')].some(td => td.textContent.trim() === ${JSON.stringify(shortSid)})
  }))()`));
  const clicked = await page.evalJs(`(() => {
    const row = [...document.querySelectorAll('.admin-table tbody tr')].find(tr => tr.querySelector('td')?.textContent.trim() === ${JSON.stringify(shortSid)});
    if (!row) return false;
    row.querySelector('.cell-actions button').click();
    return true;
  })()`);
  check('opened current session transcript', clicked);
  await page.waitFor("!!document.querySelector('.transcript')", 8000);
  check('conversation transcript', await page.evalJs(`(() => {
    const lines = [...document.querySelectorAll('.transcript p')].map(p => p.textContent.replace(/\\s+/g, ' ').trim());
    return {count: lines.length, hasUserQuestion: lines.some(l => l.includes('定制刻字')), hasStaffReply: lines.some(l => l.includes('刻字工期 2 天')), last: lines[lines.length - 1]};
  })()`));
  out.shots.push(await page.shot('29-admin-conversations'));

  check('page exceptions', errors);
} finally {
  page.close();
}

fs.writeFileSync(new URL('./results-support.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('shots:', out.shots.join(', '));
