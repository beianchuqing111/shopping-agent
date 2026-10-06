import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {api, ensureSession} from './api.js';
import {Link} from './link.jsx';
import {navigate} from './router.js';
import {useRoute} from './hooks.js';
import {formatPrice, orderStatusText} from './format.js';
import {loadSessionId} from './cart.js';

const HISTORY_KEY = 'shopping-agent.support';
const SEEN_KEY = 'shopping-agent.support-seen';
const FALLBACK_QUICK = ['查我的订单', '运费怎么算', '可以退货吗？', '转人工'];
const POLL_MS = 8000;

function loadHistory() {
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages) {
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-40)));
  } catch { /* 忽略存储失败 */ }
}

function loadSeen() {
  try {
    const raw = globalThis.localStorage?.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen) {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch { /* 忽略 */ }
}

function CardView({card}) {
  if (card.type === 'order') {
    return (
      <div className="support-card">
        <div className="support-card-head">
          <span>订单 {card.order_no}</span>
          <span className={`status status-${card.status}`}>{card.status_text}</span>
        </div>
        <ul>
          {card.items.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <div className="support-card-foot">
          <strong>{formatPrice(card.total_cents)}</strong>
          <Link to={card.link}>查看订单</Link>
        </div>
      </div>
    );
  }
  if (card.type === 'product') {
    return (
      <div className="support-card product">
        <img src={`/api/products/${card.id}/images/0.svg`} alt={card.title}/>
        <div>
          <strong>{card.title}</strong>
          <small>{formatPrice(card.price_cents)} · {card.stock > 0 ? `库存 ${card.stock}` : '缺货'}</small>
          <Link to={card.link}>查看商品</Link>
        </div>
      </div>
    );
  }
  return <div className="support-source">知识库：{card.question}</div>;
}

export default function SupportWidget() {
  const route = useRoute();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => loadHistory());
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recentOrder, setRecentOrder] = useState(null);
  const [unread, setUnread] = useState(0);
  const [pulse, setPulse] = useState(() => {
    try {
      return globalThis.localStorage?.getItem('shopping-agent.support-intro') !== '1';
    } catch {
      return true;
    }
  });
  const seenRef = useRef(loadSeen());
  const bottom = useRef(null);

  useEffect(() => { saveHistory(messages); }, [messages]);
  useEffect(() => { bottom.current?.scrollIntoView({block: 'nearest'}); }, [messages, open, busy]);

  const refreshRecentOrder = useCallback(async () => {
    const sid = loadSessionId();
    if (!sid) {
      setRecentOrder(null);
      return;
    }
    try {
      const {orders} = await api.orders(sid);
      setRecentOrder(orders?.[0] || null);
    } catch {
      setRecentOrder(null);
    }
  }, []);

  const pollStaffReplies = useCallback(async () => {
    const sid = loadSessionId();
    if (!sid) return;
    let tickets = [];
    try {
      ({tickets} = await api.sessionTickets(sid));
    } catch {
      return;
    }
    const fresh = [];
    for (const ticket of tickets || []) {
      for (const message of ticket.messages || []) {
        if (message.role !== 'staff' || !message.id) continue;
        if (seenRef.current.has(message.id)) continue;
        seenRef.current.add(message.id);
        fresh.push({ticket, message});
      }
    }
    if (!fresh.length) return;
    saveSeen(seenRef.current);
    setMessages((current) => [
      ...current,
      ...fresh.map(({ticket, message}) => ({
        role: 'agent',
        staff: true,
        content: message.content,
        ticketNo: ticket.no,
      })),
    ]);
    setUnread((count) => count + fresh.length);
  }, []);

  // 打开面板：拉快捷问题、刷新最近订单、把已展示的人工回复标记为已读
  useEffect(() => {
    if (!open) return;
    api.supportFaq()
      .then((data) => {
        setSuggestions(data.suggestions?.length ? data.suggestions : FALLBACK_QUICK);
        try { globalThis.localStorage?.setItem('shopping-agent.support-intro', '1'); } catch { /* 忽略 */ }
        setPulse(false);
      })
      .catch(() => setSuggestions(FALLBACK_QUICK));
    refreshRecentOrder();
    pollStaffReplies();
    setUnread(0);
  }, [open, refreshRecentOrder, pollStaffReplies]);

  useEffect(() => { refreshRecentOrder(); }, [route.name, route.id, refreshRecentOrder]);

  // 轮询人工回复：面板关着也能收到，悬浮球上显示未读数
  useEffect(() => {
    const timer = setInterval(pollStaffReplies, POLL_MS);
    return () => clearInterval(timer);
  }, [pollStaffReplies]);

  const contextChip = useMemo(() => {
    if (route.name === 'product' && route.id) {
      return {label: '问问这件商品', message: `${route.id} 还有货吗？多少钱？`};
    }
    if (route.name === 'order') return {label: '问这笔订单', message: '我的订单现在什么状态？'};
    if (route.name === 'checkout' || route.name === 'cart') return {label: '结算遇到问题', message: '下单后多久发货？'};
    return null;
  }, [route.name, route.id]);

  const send = useCallback(async (text) => {
    const message = (text || '').trim();
    if (!message || busy) return;
    setMessages((current) => [...current, {role: 'user', content: message}]);
    setInput('');
    setBusy(true);
    setError('');
    try {
      const sid = await ensureSession();
      const answer = await api.support(sid, message);
      setMessages((current) => [...current, {
        role: 'agent',
        content: answer.reply,
        cards: answer.cards || [],
        ticket: answer.ticket || null,
      }]);
      if (answer.suggestions?.length) setSuggestions(answer.suggestions);
      refreshRecentOrder();
      pollStaffReplies();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [busy, pollStaffReplies, refreshRecentOrder]);

  const chips = useMemo(() => {
    const base = suggestions.length ? suggestions : FALLBACK_QUICK;
    return (contextChip ? [contextChip.label, ...base] : base).slice(0, 5);
  }, [suggestions, contextChip]);

  function onChip(chip) {
    if (contextChip && chip === contextChip.label) send(contextChip.message);
    else send(chip);
  }

  return (
    <>
      {open ? (
        <section className="support-panel" role="dialog" aria-label="在线客服">
          <header className="support-head">
            <div className="support-avatar">客</div>
            <div className="support-title">
              <strong>在线客服</strong>
              <small>演示环境 · 实时查订单与商品</small>
            </div>
            <button className="support-close" onClick={() => setOpen(false)} aria-label="收起客服">✕</button>
          </header>

          {recentOrder ? (
            <div className="support-order-strip">
              <div>
                <small>最近一笔订单</small>
                <strong>{recentOrder.order_no || recentOrder.id.slice(0, 8)}</strong>
              </div>
              <span className={`status status-${recentOrder.status}`}>{orderStatusText(recentOrder.status)}</span>
              <span className="support-order-total">{formatPrice(recentOrder.total_cents)}</span>
              <Link to={`/order/${recentOrder.id}`} className="support-order-link">查看</Link>
            </div>
          ) : null}

          <div className="support-body">
            {messages.length === 0 ? (
              <div className="message assistant">
                <small>客服</small>
                <p>
                  你好，我是这家演示商城的智能客服。可以帮你查订单状态和发货进度、算运费、
                  讲退换货与保修规则，也能查商品价格和库存；答不上来的会转人工建工单。
                </p>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div key={index} className={`message ${message.role === 'user' ? 'user' : 'assistant'}`}>
                <small>{message.role === 'user' ? '你' : message.staff ? '客服（人工）' : '客服'}</small>
                <p className={message.staff ? 'staff-reply' : ''}>{message.content}</p>
                {message.ticketNo ? <div className="support-source">工单 {message.ticketNo} 的人工回复</div> : null}
                {(message.cards || []).map((card, cardIndex) => (
                  <CardView key={cardIndex} card={card}/>
                ))}
                {message.ticket ? (
                  <div className="support-source">已建工单 {message.ticket.no} · 客服后台可见</div>
                ) : null}
              </div>
            ))}
            {busy ? <div className="message assistant"><p className="typing">客服正在查询…</p></div> : null}
            <div ref={bottom}/>
          </div>

          {error ? <p className="support-error" role="alert">{error}</p> : null}

          <div className="support-chips">
            {chips.map((chip) => (
              <button key={chip} className="chip" onClick={() => onChip(chip)} disabled={busy}>{chip}</button>
            ))}
          </div>

          <form className="support-composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="描述你的问题，例如：我的订单到哪了"
              maxLength={1000}
              aria-label="客服咨询内容"
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>发送</button>
          </form>
          <p className="support-foot">自动应答基于知识库与实时订单数据；人工回复会显示在对话里（每 8 秒自动收取）。</p>
        </section>
      ) : null}

      <button
        className={open ? 'support-launcher open' : 'support-launcher'}
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? '收起在线客服' : '打开在线客服'}
        title="在线客服"
      >
        <span className="support-launcher-icon">💬</span>
        <span className="support-launcher-text">在线客服</span>
        {unread > 0 && !open ? <em className="support-unread">{unread}</em> : pulse && !open ? <em className="support-dot"/> : null}
      </button>
    </>
  );
}
