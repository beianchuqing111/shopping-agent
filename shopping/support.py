"""智能客服：意图识别 + 知识库检索 + 订单/商品实时查询 + 转人工工单。

设计原则与导购一致：**事实只来自服务端数据**。
- 订单、商品、库存一律实时查库，不编造；
- 规则类问题（运费/退换货/保修/发票/优惠/时效）来自下面的知识库，且明确标注是演示规则；
- 自动答不上来的问题不硬答，直接建工单转人工，并把对话上下文一起带上。
"""

import os
import re

ORDER_NO_RE = re.compile(r"\bSO[A-F0-9]{6,}\b")

FAQ = [
    {
        "id": "shipping-fee",
        "question": "运费怎么算？",
        "answer": (
            "演示规则：单笔订单满 ¥99 免运费，未满收 ¥10（购物车和结算页会实时算给你看）。"
        ),
        "keywords": ["运费", "邮费", "包邮", "快递费", "配送费"],
    },
    {
        "id": "delivery-time",
        "question": "多久发货、多久能到？",
        "answer": (
            "演示规则：现货商品 24 小时内发出；广东省内 1–2 天，其他地区 2–4 天。"
            "真实时效要以物流公司为准，本商城未接入真实物流。"
        ),
        "keywords": ["多久", "发货", "几天", "到货", "时效", "什么时候到", "配送时间"],
    },
    {
        "id": "return",
        "question": "可以退货吗？怎么退？",
        "answer": (
            "演示规则：未拆封商品支持 7 天无理由退货；耳机等贴身音频商品拆封后因卫生原因不支持无理由退货。"
            "流程是：订单详情页点「联系客服」→ 我这边给你建工单 → 客服在工单里回复处理方式（演示环境不会真人回复）。"
        ),
        "keywords": ["退货", "退款", "七天", "无理由", "退换", "不要了", "拒收"],
    },
    {
        "id": "payment",
        "question": "支持哪些支付方式？",
        "answer": (
            "当前是自建演示商城：支付是模拟操作（订单详情页的「模拟支付」），"
            "不接任何真实支付渠道、不会扣你的钱。接入真实渠道后这里会写明支持的方式。"
        ),
        "keywords": ["支付", "付款", "微信", "支付宝", "花呗", "分期", "刷卡", "付款方式"],
    },
    {
        "id": "invoice",
        "question": "可以开发票吗？",
        "answer": "演示规则：支持电子普通发票，下单后在工单里留下抬头与税号即可（演示环境不真实开具）。",
        "keywords": ["发票", "开票", "税号", "抬头"],
    },
    {
        "id": "warranty",
        "question": "保修和售后怎么算？",
        "answer": "演示规则：耳机、键鼠、麦克风等外设 12 个月质保，显示器 24 个月；非人为损坏免费维修。",
        "keywords": ["保修", "质保", "售后", "坏了", "维修", "损坏", "维修点"],
    },
    {
        "id": "coupon",
        "question": "有优惠券或活动吗？",
        "answer": "演示规则：首页「限时优惠」是当前折扣价；满 ¥99 免运费，可与折扣叠加。优惠券功能还没做。",
        "keywords": ["优惠", "优惠券", "券", "折扣", "活动", "满减", "便宜点", "打折"],
    },
    {
        "id": "stock",
        "question": "缺货商品什么时候补货？",
        "answer": "缺货商品不会出现在检索和推荐里。把商品名发我，我建个工单让客服在补货时通知你。",
        "keywords": ["缺货", "补货", "没货", "什么时候有货", "库存"],
    },
    {
        "id": "hours",
        "question": "客服工作时间？",
        "answer": "演示客服时间：工作日 9:00–18:00。本机演示环境没有真人坐席，你的问题会记成工单留在管理后台。",
        "keywords": ["工作时间", "几点", "在线吗", "上班", "人工时间"],
    },
]

HUMAN_KEYWORDS = ["转人工", "人工客服", "真人", "客服电话", "投诉", "举报", "要找个人", "找人"]
GREETING_KEYWORDS = ["你好", "您好", "在吗", "hi", "hello", "有人吗"]
THANKS_KEYWORDS = ["谢谢", "感谢", "多谢", "3q", "thanks", "好的"]
ORDER_KEYWORDS = [
    "我的订单", "订单", "订单号", "订单状态", "到哪了", "发货了吗", "发货没",
    "物流", "快递", "运单", "签收", "不想要了", "还没收到",
]
STOPWORDS = {"的", "吗", "呢", "啊", "我", "你", "想要", "有没有", "有", "是", "了", "请问", "一下", "这个", "那个"}
# 商品匹配的分数门槛：中文按 2–3 字组合命中，太松会把闲聊也判成商品咨询
PRODUCT_MATCH_THRESHOLD = 4

STATUS_TEXT = {
    "pending_payment": "待支付",
    "paid": "已支付",
    "shipped": "已发货",
    "completed": "已完成",
    "cancelled": "已取消",
}

CATEGORY_NAMES = {
    "耳机": "headphones",
    "键盘": "keyboard",
    "鼠标": "mouse",
    "音箱": "speaker",
    "显示器": "monitor",
    "麦克风": "microphone",
    "配件": "accessory",
}

BASE_SUGGESTIONS = ["查我的订单", "运费怎么算", "可以开发票吗", "转人工"]


def faq_list():
    return [{"id": item["id"], "question": item["question"]} for item in FAQ]


def _match_faq(message):
    best, best_score = None, 0
    for item in FAQ:
        score = 0
        for keyword in item["keywords"]:
            if keyword in message:
                score += len(keyword)
        for word in item["question"]:
            if len(word) > 1 and word in message:
                score += 1
        if score > best_score:
            best, best_score = item, score
    return best if best_score >= 2 else None


def _extract_terms(message):
    """中文没有空格，所以除了整段 token 还要拆出 2–3 字组合，否则「便携屏多少钱」匹配不到商品。"""
    text = message
    for stop in STOPWORDS:
        text = text.replace(stop, " ")
    terms = {term for term in re.split(r"[^\w\u4e00-\u9fff]+", text) if len(term) >= 2}
    for block in re.findall(r"[\u4e00-\u9fff]+", message):
        for size in (2, 3):
            for index in range(len(block) - size + 1):
                terms.add(block[index : index + size])
    return {term for term in terms if term not in STOPWORDS and len(term) >= 2}


def _product_card(product):
    return {
        "type": "product",
        "id": product["id"],
        "title": product["title"],
        "price_cents": product["price_cents"],
        "stock": product["stock"],
        "link": f"/p/{product['id']}",
    }


def _order_card(order):
    return {
        "type": "order",
        "id": order["id"],
        "order_no": order.get("order_no") or order["id"][:8],
        "status": order["status"],
        "status_text": STATUS_TEXT.get(order["status"], order["status"]),
        "total_cents": order["total_cents"],
        "items": [f"{i['title']} ×{i['quantity']}" for i in order["items"]],
        "link": f"/order/{order['id']}",
    }


def _match_products(message, products):
    terms = _extract_terms(message)
    scored = []
    for product in products:
        if product.get("published") is False:
            continue
        haystack = " ".join(
            [
                product["title"],
                product.get("brand", ""),
                product.get("sku", ""),
                product["id"],
                " ".join(product.get("features", [])),
                product.get("description", ""),
                " ".join(product.get("tags", [])),
            ]
        ).lower()
        score = 0
        for term in terms:
            if term.lower() in haystack:
                score += len(term)
        for name, key in CATEGORY_NAMES.items():
            if name in message and product["category"] == key:
                score += 3
        if score >= PRODUCT_MATCH_THRESHOLD:
            scored.append((score, product))
    scored.sort(key=lambda pair: (-pair[0], -pair[1].get("sold", 0)))
    return [product for _, product in scored[:3]]


def _order_reply(message, orders):
    match = ORDER_NO_RE.search(message.upper())
    order = None
    if match:
        order = next(
            (o for o in orders if (o.get("order_no") or "").upper() == match.group(0)),
            None,
        )
        if order is None:
            return {
                "reply": (
                    f"没查到订单号 {match.group(0)}。请确认订单号是否完整（格式是 SO 开头加 12 位字符），"
                    "或者用下单时的浏览器再打开「我的订单」看看。"
                ),
                "cards": [],
                "suggestions": ["查我的订单", "转人工"],
                "needs_human": True,
            }
    elif orders:
        order = orders[0]
    else:
        return {
            "reply": (
                "你这台浏览器上还没有订单记录。可以先挑商品下单，"
                "下单后我就能在这里帮你查状态、支付和发货进度了。"
            ),
            "cards": [],
            "suggestions": ["运费怎么算", "怎么下单", "全部商品"],
            "needs_human": False,
        }

    status = STATUS_TEXT.get(order["status"], order["status"])
    if order["status"] == "pending_payment":
        tail = "这笔还没支付，订单详情页点「模拟支付」就能跑通后续流程。"
    elif order["status"] == "paid":
        tail = "已收到款（演示），仓库 24 小时内发货。"
    elif order["status"] == "shipped":
        tail = "已经发货了，本演示环境没有真实运单号。"
    elif order["status"] == "cancelled":
        tail = "这笔订单已取消，库存没有被扣减。"
    else:
        tail = "这笔订单已经完成。"
    return {
        "reply": (
            f"查到订单 {order.get('order_no') or order['id'][:8]}：当前状态「{status}」，"
            f"共 {len(order['items'])} 种商品、实付 ¥{order['total_cents'] / 100:.2f}。{tail}"
        ),
        "cards": [_order_card(order)],
        "suggestions": ["这笔怎么退款？", "运费怎么算", "转人工"],
        "needs_human": False,
    }


def _products_reply(message, products):
    hits = _match_products(message, products)
    if not hits:
        return None
    in_stock = [p for p in hits if p["stock"] > 0]
    out = [p for p in hits if p["stock"] == 0]
    if in_stock:
        first = in_stock[0]
        reply = (
            f"找到 {len(hits)} 件相关的：{first['title']}，现价 ¥{first['price_cents'] / 100:.2f}，"
            f"库存 {first['stock']} 件。"
        )
        if out:
            reply += f"另外 {out[0]['title']} 目前缺货，需要的话我帮你转人工登记补货通知。"
    else:
        reply = (
            f"{hits[0]['title']} 目前缺货（库存 0），缺货商品不会进入检索结果。"
            "要补货通知的话我帮你建工单。"
        )
    return {
        "reply": reply,
        "cards": [_product_card(p) for p in hits],
        "suggestions": ["这款有优惠吗？", "运费怎么算", "转人工"],
        "needs_human": not in_stock,
    }


def _ticket(messages):
    return "\n".join(f"{'用户' if m['role'] == 'user' else '客服'}：{m['content']}" for m in messages[-6:])


def respond(message, store, session_id, products=None):
    """返回客服回复：reply / cards / suggestions / needs_human / intent。"""
    text = (message or "").strip()
    products = store.products() if products is None else products
    orders = store.orders_for(session_id)
    session = store.session(session_id) or {}
    history = session.get("support") or []

    def with_ticket(reply, cards, suggestions, intent, subject, extra_messages=None):
        ticket = store.create_ticket(
            session_id,
            subject=subject or text[:40],
            messages=(extra_messages or []) + history + [{"role": "user", "content": text}],
        )
        return {
            "reply": f"{reply}\n\n已经为你建好工单 {ticket['no']}，客服会接着这条继续回复（演示环境记录在管理后台）。",
            "cards": cards,
            "suggestions": ["补充说明问题", "查我的订单", "运费怎么算"],
            "needs_human": True,
            "ticket": {"no": ticket["no"], "id": ticket["id"], "status": ticket["status"]},
            "intent": intent,
        }

    if not text:
        return {
            "reply": "想咨询什么？比如订单状态、运费、退货、保修，或者直接说「转人工」。",
            "cards": [],
            "suggestions": BASE_SUGGESTIONS,
            "needs_human": False,
            "intent": "empty",
        }

    if any(keyword in text for keyword in HUMAN_KEYWORDS):
        recent = [{"role": "user", "content": text}]
        if orders:
            recent.insert(
                0,
                {
                    "role": "user",
                    "content": (
                        f"（我的最近订单：{orders[0].get('order_no')}，"
                        f"状态 {STATUS_TEXT.get(orders[0]['status'], orders[0]['status'])}）"
                    ),
                },
            )
        return with_ticket(
            "好的，转人工处理。",
            [_order_card(orders[0])] if orders else [],
            ["查我的订单", "运费怎么算"],
            "human",
            subject="用户请求转人工：" + text[:30],
            extra_messages=recent,
        )

    if any(keyword in text for keyword in THANKS_KEYWORDS):
        return {
            "reply": "不客气～还有别的问题随时问我：订单、运费、退货、保修都能查。",
            "cards": [],
            "suggestions": ["查我的订单", "退换货政策"],
            "needs_human": False,
            "intent": "thanks",
        }

    if ORDER_NO_RE.search(text.upper()) or any(keyword in text for keyword in ORDER_KEYWORDS):
        result = _order_reply(text, orders)
        if result["needs_human"]:
            return {
                **with_ticket(
                    result["reply"],
                    result["cards"],
                    result["suggestions"],
                    "order",
                    subject="订单查询需人工：" + text[:30],
                )
            }
        return {**result, "intent": "order"}

    product_answer = _products_reply(text, products)
    if product_answer and product_answer.get("needs_human"):
        return {
            **with_ticket(
                product_answer["reply"],
                product_answer["cards"],
                product_answer["suggestions"],
                "product",
                subject="缺货/补货咨询：" + text[:30],
            )
        }
    if product_answer and not _match_faq(text):
        return {**product_answer, "intent": "product"}

    faq = _match_faq(text)
    if faq:
        if faq["id"] == "stock":
            return with_ticket(
                faq["answer"],
                [],
                ["查我的订单", "转人工"],
                "faq-stock",
                subject="缺货/补货咨询：" + text[:30],
            )
        return {
            "reply": faq["answer"],
            "cards": [{"type": "faq", "id": faq["id"], "question": faq["question"]}],
            "suggestions": [
                s for s in ["查我的订单", "退换货政策", "转人工"] if s != faq["question"]
            ],
            "needs_human": False,
            "intent": f"faq:{faq['id']}",
        }

    if product_answer:
        return {**product_answer, "intent": "product"}

    if any(keyword in text for keyword in GREETING_KEYWORDS):
        return {
            "reply": (
                "你好，我是这家演示商城的智能客服。可以帮你查订单状态、物流进度、"
                "运费与退换货规则，也能查商品价格和库存，答不上来的会转人工建工单。"
            ),
            "cards": [],
            "suggestions": BASE_SUGGESTIONS,
            "needs_human": False,
            "intent": "greeting",
        }

    return with_ticket(
        (
            "这个问题我暂时答不上来，为了不给你错误信息，我直接转人工。"
            "你可以再补充一句（比如订单号、商品名、具体诉求），客服会看到完整上下文。"
        ),
        [],
        BASE_SUGGESTIONS,
        "unknown",
        subject="待人工解答：" + text[:30],
    )


async def polish(reply, message, transport=None, api_key=None):
    """可选：用模型把回复改得更口语化。只允许改写措辞，不允许新增事实。"""
    import httpx

    prompt = (
        "你是电商客服。下面是一条客服回复，请改写成更自然口语的中文，"
        "只允许调整措辞与语气，**不得新增、删改任何事实、数字、订单号、规则**，"
        "长度不超过原文的两倍，直接输出改写结果，不要解释。\n\n"
        f"用户问题：{message}\n客服回复：{reply}"
    )
    async with httpx.AsyncClient(transport=transport, timeout=30) as client:
        response = await client.post(
            os.environ.get("LLM_BASE_URL", "https://api.openai-next.com/v1").rstrip("/")
            + "/chat/completions",
            headers={
                "Authorization": "Bearer "
                + (api_key or os.environ.get("OPENAI_NEXT_API_KEY", ""))
            },
            json={
                "model": os.environ.get("LLM_MODEL", "gpt-6-sol"),
                "messages": [{"role": "user", "content": prompt}],
                "max_completion_tokens": 600,
            },
        )
        if response.status_code != 200:
            raise RuntimeError(f"LLM provider returned HTTP {response.status_code}")
        content = response.json()["choices"][0]["message"].get("content") or ""
    polished = content.strip()
    if not polished:
        raise ValueError("empty polish result")
    return polished
