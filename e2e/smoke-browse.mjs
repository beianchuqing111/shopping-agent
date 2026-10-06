import {newPage, setInput} from './cdp.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:58123';
const out = {step: 'browse', checks: [], shots: []};
const check = (name, value) => {
  out.checks.push({name, value});
  console.log(`- ${name}: ${JSON.stringify(value)}`);
};

const page = await newPage();
try {
  const errors = [];
  await page.send('Runtime.evaluate', {expression: 'window.__errors = []'});
  await page.goto(BASE + '/', 2500);
  await page.evalJs("window.addEventListener('error', e => window.__errors.push(String(e.message)))");

  check('home title', await page.evalJs('document.title'));
  const home = await page.evalJs(`(() => ({
    nav: [...document.querySelectorAll('.nav-link')].map(a => a.textContent.trim()),
    categories: [...document.querySelectorAll('.category-card strong')].map(e => e.textContent.trim()),
    categoryCount: document.querySelectorAll('.category-card').length,
    cards: document.querySelectorAll('.card').length,
    deals: document.querySelectorAll('.deal').length,
    stats: [...document.querySelectorAll('.hero-stats dd')].map(e => e.textContent.trim()),
    brokenImages: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
    totalImages: document.querySelectorAll('img').length
  }))()`);
  check('home dom', home);
  out.shots.push(await page.shot('01-home'));

  // 分类列表 + 排序
  await page.goto(BASE + '/#/c/keyboard', 2000);
  const catalog = await page.evalJs(`(() => ({
    heading: document.querySelector('.catalog-main h1')?.textContent.trim(),
    count: document.querySelector('.catalog-head span')?.textContent.trim(),
    cards: document.querySelectorAll('.card').length,
    firstTitles: [...document.querySelectorAll('.card h3')].slice(0, 3).map(h => h.textContent.trim()),
    filterLinks: document.querySelectorAll('.filters a').length,
    activeFilter: document.querySelector('.filters a.active')?.textContent.trim()
  }))()`);
  check('catalog dom', catalog);
  out.shots.push(await page.shot('02-catalog'));

  // 价格排序
  await page.goto(BASE + '/#/s?q=' + encodeURIComponent('便携'), 1800);
  const search = await page.evalJs(`(() => ({
    heading: document.querySelector('.catalog-main h1')?.textContent.trim(),
    cards: document.querySelectorAll('.card').length,
    titles: [...document.querySelectorAll('.card h3')].map(h => h.textContent.trim())
  }))()`);
  check('search 便携', search);
  out.shots.push(await page.shot('03-search'));

  // 商品详情
  await page.goto(BASE + '/#/p/hp-002', 2000);
  const detail = await page.evalJs(`(() => ({
    title: document.querySelector('.buy-box h1')?.textContent.trim(),
    sku: document.querySelector('.brand-line')?.textContent.trim(),
    price: document.querySelector('.price-large strong')?.textContent.trim(),
    listPrice: document.querySelector('.price-large s')?.textContent.trim(),
    thumbs: document.querySelectorAll('.thumb').length,
    specs: document.querySelectorAll('.specs div').length,
    features: [...document.querySelectorAll('.feature-list li')].map(e => e.textContent.trim()),
    stock: document.querySelector('.rate-row')?.textContent.replace(/\\s+/g, ' ').trim(),
    related: document.querySelectorAll('.card').length,
    stageImage: document.querySelector('.gallery-stage img')?.getAttribute('src'),
    stageLoaded: document.querySelector('.gallery-stage img')?.naturalWidth
  }))()`);
  check('product detail', detail);
  out.shots.push(await page.shot('04-product'));

  // 切换视角 + 加入购物车
  await page.evalJs("document.querySelectorAll('.thumb')[2].click()");
  await new Promise((r) => setTimeout(r, 800));
  check('view3 image', await page.evalJs("document.querySelector('.gallery-stage img').getAttribute('src')"));
  await page.evalJs("document.querySelector('.qty input') && document.querySelector('.buy-actions .btn-primary').click()");
  await page.waitFor("!!document.querySelector('.toast')", 5000);
  const cart = await page.evalJs(`(() => ({
    toast: document.querySelector('.toast')?.textContent.trim(),
    badge: document.querySelector('.cart-badge')?.textContent.trim(),
    stored: JSON.parse(localStorage.getItem('shopping-agent.cart') || '[]')
  }))()`);
  check('add to cart', cart);
  out.shots.push(await page.shot('05-product-added'));

  check('page errors', await page.evalJs('window.__errors'));
  check('console error count', errors.length);
} finally {
  page.close();
}

fs.mkdirSync('C:/Users/13917/shopping-agent/.runtime/qa', {recursive: true});
fs.writeFileSync(new URL('./results-browse.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('shots:', out.shots.join(', '));
