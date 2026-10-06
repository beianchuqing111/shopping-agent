// 端到端冒烟测试用的 CDP 驱动：连接本地无头 Chrome（Node 22 内置 WebSocket / fetch）。
// 用法：先启动无头 Chrome（见 e2e/README.md），再运行 smoke-*.mjs。
import fs from 'node:fs';
import path from 'node:path';

export const PORT = process.env.CDP_PORT || 9333;
const DEFAULT_SHOTS = path.join(import.meta.dirname, 'shots');
const SHOT_DIR = process.env.SHOT_DIR || DEFAULT_SHOTS;

export class CDP {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const {resolve, reject} = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    };
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.ws.send(JSON.stringify({id, method, params}));
    });
  }

  async init(width = 1440, height = 1000) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Network.setCacheDisabled', {cacheDisabled: true});
    await this.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  }

  async goto(url, waitMs = 1500) {
    await this.send('Page.navigate', {url});
    await new Promise((r) => setTimeout(r, waitMs));
  }

  async evalJs(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(String(result.exceptionDetails.exception?.description || result.exceptionDetails.text));
    }
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 15000, stepMs = 300) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.evalJs(expression)) return true;
      if (Date.now() > deadline) throw new Error(`timeout waiting for: ${expression}`);
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }

  async shot(name) {
    fs.mkdirSync(SHOT_DIR, {recursive: true});
    const result = await this.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
    const file = path.join(SHOT_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

export async function newPage() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, {method: 'PUT'});
  if (!response.ok) throw new Error(`cannot create target: ${response.status}`);
  const target = await response.json();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.init();
  return cdp;
}

// React 受控输入需要用原生 setter + input 事件才能真正改值
export const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return true;
})()`;
