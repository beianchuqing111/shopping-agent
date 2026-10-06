import {Fragment, useCallback, useEffect, useState} from 'react';
import {api} from '../api.js';
import {Link} from '../link.jsx';
import {ErrorNote, Loading} from '../ui.jsx';
import {loadAdminToken, saveAdminToken} from '../cart.js';
import {formatPrice, orderStatusText} from '../format.js';

const EMPTY_NEW = {title: '', category: 'headphones', brand: '', price: '', stock: ''};

export default function Admin() {
  const [token, setToken] = useState(() => loadAdminToken());
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [replies, setReplies] = useState({});
  const [openedConversation, setOpenedConversation] = useState('');
  const [drafts, setDrafts] = useState({});
  const [draftNew, setDraftNew] = useState(EMPTY_NEW);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (activeToken) => {
    setLoading(true);
    setError('');
    try {
      const [list, orderList, ticketList, conversationList] = await Promise.all([
        api.adminProducts(activeToken),
        api.adminOrders(activeToken),
        api.adminTickets(activeToken),
        api.adminConversations(activeToken),
      ]);
      setProducts(list.products);
      setCategories(list.categories);
      setOrders(orderList.orders);
      setTickets(ticketList.tickets);
      setConversations(conversationList.conversations);
      setAuthed(true);
      saveAdminToken(activeToken);
    } catch (e) {
      setAuthed(false);
      setError(e.status === 403 ? '管理令牌不正确，或服务端未设置 ADMIN_TOKEN。' : e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (token) load(token); }, [token, load]);

  async function run(action, successMessage) {
    setError('');
    try {
      await action();
      await load(token);
      setNotice(successMessage);
      setTimeout(() => setNotice(''), 2500);
    } catch (e) {
      setError(e.message);
    }
  }

  function draft(product) {
    return drafts[product.id] || {price: (product.price_cents / 100).toString(), stock: String(product.stock)};
  }

  function setDraft(id, patch) {
    setDrafts((current) => ({...current, [id]: {...(current[id] || {}), ...patch}}));
  }

  if (!authed) {
    return (
      <div className="page admin-login">
        <h1>管理后台登录</h1>
        <p className="hint">
          管理接口使用 <code>X-Admin-Token</code> 请求头校验，令牌只保存在服务端环境变量 <code>ADMIN_TOKEN</code> 中。
          本机启动服务时请在项目 <code>.env</code> 或环境变量里设置它。
        </p>
        <form onSubmit={(e) => { e.preventDefault(); load(token); }}>
          <label className="field">
            管理令牌
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN"/>
          </label>
          <button className="btn btn-primary btn-lg" type="submit" disabled={loading || !token}>
            {loading ? '正在验证…' : '登录'}
          </button>
        </form>
        <ErrorNote message={error}/>
        <p><Link to="/" className="btn">返回商城首页</Link></p>
      </div>
    );
  }

  const filtered = products.filter((p) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [p.id, p.sku, p.title, p.brand].some((v) => String(v || '').toLowerCase().includes(needle));
  });

  return (
    <div className="page admin-page">
      <header className="admin-head">
        <h1>管理后台</h1>
        <div className="admin-tabs">
          <button className={tab === 'products' ? 'chip active' : 'chip'} onClick={() => setTab('products')}>商品管理（{products.length}）</button>
          <button className={tab === 'orders' ? 'chip active' : 'chip'} onClick={() => setTab('orders')}>订单管理（{orders.length}）</button>
          <button className={tab === 'tickets' ? 'chip active' : 'chip'} onClick={() => setTab('tickets')}>
            客服工单（{tickets.filter((t) => t.status === 'open').length} 待处理 / {tickets.length}）
          </button>
          <button className={tab === 'conversations' ? 'chip active' : 'chip'} onClick={() => setTab('conversations')}>
            客服会话（{conversations.length}）
          </button>
          <button className="chip" onClick={() => load(token)}>重新加载</button>
          <button className="chip" onClick={() => { saveAdminToken(''); setToken(''); setAuthed(false); }}>退出</button>
        </div>
      </header>

      <ErrorNote message={error}/>
      {notice ? <div className="state notice">{notice}</div> : null}
      {loading ? <Loading label="正在读取后台数据…"/> : null}

      {tab === 'products' ? (
        <>
          <form className="admin-create" onSubmit={(e) => {
            e.preventDefault();
            run(
              () => api.adminCreateProduct(token, {
                title: draftNew.title,
                category: draftNew.category,
                brand: draftNew.brand || null,
                price_cents: Math.round(Number(draftNew.price) * 100),
                stock: Number(draftNew.stock || 0),
              }),
              `已新建商品：${draftNew.title}`,
            ).then(() => setDraftNew(EMPTY_NEW));
          }}>
            <h2>新建商品</h2>
            <label className="field">名称<input value={draftNew.title} onChange={(e) => setDraftNew({...draftNew, title: e.target.value})} placeholder="商品名称" required/></label>
            <label className="field">分类
              <select value={draftNew.category} onChange={(e) => setDraftNew({...draftNew, category: e.target.value})}>
                {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
            <label className="field">品牌<input value={draftNew.brand} onChange={(e) => setDraftNew({...draftNew, brand: e.target.value})} placeholder="可选"/></label>
            <label className="field">售价（元）<input value={draftNew.price} onChange={(e) => setDraftNew({...draftNew, price: e.target.value})} inputMode="decimal" placeholder="199.00" required/></label>
            <label className="field">库存<input value={draftNew.stock} onChange={(e) => setDraftNew({...draftNew, stock: e.target.value})} inputMode="numeric" placeholder="0"/></label>
            <button className="btn btn-primary" type="submit">创建</button>
          </form>

          <div className="admin-toolbar">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按名称 / SKU / 品牌筛选" aria-label="筛选商品"/>
            <span>显示 {filtered.length} / {products.length} 件</span>
          </div>

          <table className="table admin-table">
            <thead>
              <tr><th>商品</th><th>SKU</th><th>分类</th><th>售价（元）</th><th>库存</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const value = draft(product);
                return (
                  <tr key={product.id} className={product.published === false ? 'row-off' : ''}>
                    <td className="cell-product">
                      <img src={`/api/products/${product.id}/images/0.svg`} alt=""/>
                      <div>
                        <Link to={`/p/${product.id}`}>{product.title}</Link>
                        <small>{product.brand} · v{product.version}</small>
                      </div>
                    </td>
                    <td>{product.sku || product.id}</td>
                    <td>{product.category}</td>
                    <td><input className="mini" value={value.price} onChange={(e) => setDraft(product.id, {price: e.target.value})} aria-label={`${product.title} 售价`}/></td>
                    <td><input className="mini" value={value.stock} onChange={(e) => setDraft(product.id, {stock: e.target.value})} aria-label={`${product.title} 库存`}/></td>
                    <td>{product.published === false ? <span className="status status-cancelled">已下架</span> : <span className="status status-paid">在售</span>}</td>
                    <td className="cell-actions">
                      <button className="btn btn-sm btn-primary" onClick={() => run(
                        () => api.adminUpdateProduct(token, product.id, {
                          price_cents: Math.round(Number(value.price) * 100),
                          stock: Number(value.stock || 0),
                        }),
                        `${product.title} 已保存`,
                      )}>保存</button>
                      <button className="btn btn-sm" onClick={() => run(
                        () => api.adminUpdateProduct(token, product.id, {published: product.published === false}),
                        product.published === false ? `${product.title} 已上架` : `${product.title} 已下架`,
                      )}>{product.published === false ? '上架' : '下架'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : tab === 'orders' ? (
        <table className="table admin-table">
          <thead>
            <tr><th>订单号</th><th>状态</th><th>商品</th><th>合计</th><th>收货人</th><th>操作</th></tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={6}>还没有订单。到前台下一单试试。</td></tr>
            ) : orders.map((order) => (
              <tr key={order.id}>
                <td>{order.order_no || order.id.slice(0, 8)}</td>
                <td><span className={`status status-${order.status}`}>{orderStatusText(order.status)}</span></td>
                <td>{order.items.map((i) => `${i.title} ×${i.quantity}`).join('、')}</td>
                <td>{formatPrice(order.total_cents)}</td>
                <td>{order.address?.recipient || '—'}</td>
                <td className="cell-actions">
                  <button className="btn btn-sm btn-primary" disabled={order.status === 'pending_payment' || order.status === 'shipped'} onClick={() => run(() => api.adminShip(token, order.id), '已标记发货')}>发货</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : tab === 'tickets' ? (
        <table className="table admin-table">
          <thead>
            <tr><th>工单号</th><th>状态</th><th>主题</th><th>对话上下文</th><th>创建时间</th><th>人工回复</th><th>操作</th></tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr><td colSpan={7}>还没有客服工单。在页面右下角的「在线客服」里点「转人工」或问一个答不上来的问题就会生成。</td></tr>
            ) : tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.no}</td>
                <td>
                  <span className={ticket.status === 'open' ? 'status status-pending_payment' : 'status status-completed'}>
                    {ticket.status === 'open' ? '待处理' : '已关闭'}
                  </span>
                </td>
                <td>{ticket.subject}</td>
                <td className="cell-context">
                  {(ticket.messages || []).slice(-3).map((message, index) => (
                    <small key={index}>{message.role === 'user' ? '用户' : '客服'}：{message.content}</small>
                  ))}
                </td>
                <td>{ticket.created_at?.replace('T', ' ').replace('+00:00', ' UTC')}</td>
                <td className="cell-reply">
                  <input
                    value={replies[ticket.id] || ''}
                    onChange={(e) => setReplies({...replies, [ticket.id]: e.target.value})}
                    placeholder="回复用户（会出现在他的客服面板）"
                    aria-label={`回复工单 ${ticket.no}`}
                  />
                  <div className="cell-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={!(replies[ticket.id] || '').trim()}
                      onClick={() => run(
                        async () => {
                          await api.adminReplyTicket(token, ticket.id, replies[ticket.id].trim());
                          setReplies({...replies, [ticket.id]: ''});
                        },
                        `${ticket.no} 已回复`,
                      )}
                    >发送回复</button>
                    <button
                      className="btn btn-sm"
                      disabled={!(replies[ticket.id] || '').trim()}
                      onClick={() => run(
                        async () => {
                          await api.adminReplyTicket(token, ticket.id, replies[ticket.id].trim(), true);
                          setReplies({...replies, [ticket.id]: ''});
                        },
                        `${ticket.no} 已回复并关闭`,
                      )}
                    >回复并关闭</button>
                  </div>
                </td>
                <td className="cell-actions">
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={ticket.status !== 'open'}
                    onClick={() => run(() => api.adminCloseTicket(token, ticket.id), `${ticket.no} 已关闭`)}
                  >关闭工单</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="table admin-table">
          <thead>
            <tr><th>客服会话</th><th>消息数</th><th>最近一条</th><th>最近活跃</th><th>操作</th></tr>
          </thead>
          <tbody>
            {conversations.length === 0 ? (
              <tr><td colSpan={5}>还没有客服对话记录。用户在右下角「在线客服」提问后就会出现在这里。</td></tr>
            ) : conversations.map((conversation) => (
              <Fragment key={conversation.session_id}>
                <tr>
                  <td>{conversation.session_id.slice(0, 8)}</td>
                  <td>{conversation.message_count}</td>
                  <td>
                    <small>{conversation.last_role === 'user' ? '用户' : '客服'}：</small>{conversation.last_content}
                  </td>
                  <td>{conversation.last_at ? conversation.last_at.replace('T', ' ').replace('+00:00', ' UTC') : '—'}</td>
                  <td className="cell-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setOpenedConversation(
                        openedConversation === conversation.session_id ? '' : conversation.session_id,
                      )}
                    >
                      {openedConversation === conversation.session_id ? '收起对话' : '查看对话'}
                    </button>
                  </td>
                </tr>
                {openedConversation === conversation.session_id ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="transcript">
                        {conversation.messages.map((message, index) => (
                          <p key={index} className={message.role === 'user' ? 'from-user' : 'from-agent'}>
                            <span>{message.role === 'user' ? '用户' : '客服'}</span>
                            {message.content}
                          </p>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
