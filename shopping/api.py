import os
import secrets
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from shopping import images, support
from shopping.catalog import explicit_patch, search
from shopping.catalog_data import CATEGORIES
from shopping.store import Store

CATEGORY_KEYS = "|".join(c["key"] for c in CATEGORIES)


class Constraints(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    category: str | None = Field(default=None, pattern=f"^({CATEGORY_KEYS})$")
    brand: str | None = Field(default=None, max_length=100)
    max_price_cents: int | None = Field(default=None, ge=0, le=100000000)


class Chat(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    constraints: Constraints = Field(default_factory=Constraints)


class Compare(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=4)


class CartItem(BaseModel):
    product_id: str = Field(min_length=1, max_length=100)
    quantity: int = Field(ge=1, le=99)


class Address(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient: str = Field(min_length=1, max_length=40)
    phone: str = Field(min_length=6, max_length=20)
    detail: str = Field(min_length=4, max_length=200)
    postcode: str | None = Field(default=None, max_length=12)


class CreateOrder(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    items: list[CartItem] = Field(min_length=1, max_length=20)
    address: Address | None = None


class ProductEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    event_id: str = Field(min_length=1, max_length=100)
    product_id: str = Field(min_length=1, max_length=100)
    version: int = Field(ge=1)
    price_cents: int = Field(ge=0)
    stock: int = Field(ge=0)


class ProductUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=60)
    category: str | None = Field(default=None, pattern=f"^({CATEGORY_KEYS})$")
    price_cents: int | None = Field(default=None, ge=0, le=100000000)
    list_price_cents: int | None = Field(default=None, ge=0, le=100000000)
    stock: int | None = Field(default=None, ge=0, le=1000000)
    published: bool | None = None
    description: str | None = Field(default=None, max_length=2000)
    features: list[str] | None = Field(default=None, max_length=12)
    tags: list[str] | None = Field(default=None, max_length=12)


class SupportMessage(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class TicketReply(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    close: bool = False


class ProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(pattern=f"^({CATEGORY_KEYS})$")
    brand: str | None = Field(default=None, max_length=60)
    sku: str | None = Field(default=None, max_length=40)
    price_cents: int = Field(ge=0, le=100000000)
    list_price_cents: int | None = Field(default=None, ge=0, le=100000000)
    stock: int = Field(default=0, ge=0, le=1000000)
    published: bool = True
    description: str | None = Field(default=None, max_length=2000)
    features: list[str] | None = Field(default=None, max_length=12)


def create_app(database_url=None, llm=True):
    store = Store(
        database_url
        or os.environ.get(
            "DATABASE_URL", "postgresql+psycopg://shop@127.0.0.1:55432/shopping_agent"
        )
    )

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        yield
        store.engine.dispose()

    app = FastAPI(title="Shopping Agent · 自建演示商城", lifespan=lifespan)
    app.state.store = store

    def get_session(sid):
        session = store.session(sid)
        if session is None:
            raise HTTPException(404, "Session not found")
        return session

    def published(products=None):
        items = store.products() if products is None else products
        return [p for p in items if p.get("published", True)]

    def require_admin(x_admin_token):
        expected = os.environ.get("ADMIN_TOKEN")
        if not expected or not secrets.compare_digest(x_admin_token or "", expected):
            raise HTTPException(403, "Admin token required")

    def list_products(
        q=None, category=None, sort="default", page=1, page_size=12, price_min=None, price_max=None
    ):
        items = published()
        if category:
            items = [p for p in items if p["category"] == category]
        if price_min is not None:
            items = [p for p in items if p["price_cents"] >= price_min]
        if price_max is not None:
            items = [p for p in items if p["price_cents"] <= price_max]
        if q:
            needle = q.strip().lower()
            items = [
                p
                for p in items
                if needle in p["title"].lower()
                or needle in p.get("brand", "").lower()
                or any(needle in f.lower() for f in p.get("features", []))
                or needle in p.get("description", "").lower()
            ]
        if sort == "price_asc":
            items.sort(key=lambda p: (p["price_cents"], p["id"]))
        elif sort == "price_desc":
            items.sort(key=lambda p: (-p["price_cents"], p["id"]))
        elif sort == "rating":
            items.sort(key=lambda p: (-p.get("rating", 0), p["id"]))
        elif sort == "new":
            items.sort(key=lambda p: p["id"], reverse=True)
        else:
            items.sort(key=lambda p: (-p.get("sold", 0), p["id"]))
        total = len(items)
        page = max(1, page)
        page_size = max(1, min(60, page_size))
        start = (page - 1) * page_size
        counts = {c["key"]: 0 for c in CATEGORIES}
        for item in published():
            if item["category"] in counts:
                counts[item["category"]] += 1
        return {
            "products": items[start : start + page_size],
            "total": total,
            "page": page,
            "page_size": page_size,
            "categories": [
                {**c, "count": counts[c["key"]]} for c in CATEGORIES
            ],
        }

    # ---------------- 基础 ----------------

    @app.get("/health")
    def health():
        with store.engine.connect() as c:
            c.execute(text("SELECT 1"))
        items = store.products()
        return {
            "status": "ok",
            "database": store.engine.dialect.name,
            "catalog": "synthetic-fixture",
            "products": len(items),
            "published": len(published(items)),
            "llm": bool(llm and os.environ.get("OPENAI_NEXT_API_KEY")),
            "kafka": "separate-worker-not-probed",
        }

    @app.get("/api/categories")
    def categories():
        items = published()
        counts = {c["key"]: 0 for c in CATEGORIES}
        for p in items:
            if p["category"] in counts:
                counts[p["category"]] += 1
        return {
            "categories": [{**c, "count": counts[c["key"]]} for c in CATEGORIES]
        }

    # ---------------- 商品 ----------------

    @app.get("/api/catalog")
    def catalog():
        return {"products": search(published(), {}), "source": "synthetic-fixture"}

    @app.get("/api/products")
    def product_list(
        q: str | None = Query(default=None, max_length=100),
        category: str | None = Query(default=None, max_length=40),
        sort: str = Query(default="default", pattern="^(default|price_asc|price_desc|rating|new)$"),
        page: int = Query(default=1, ge=1, le=1000),
        page_size: int = Query(default=12, ge=1, le=60),
        price_min: int | None = Query(default=None, ge=0),
        price_max: int | None = Query(default=None, ge=0),
    ):
        return list_products(q, category, sort, page, page_size, price_min, price_max)

    @app.get("/api/products/{product_id}")
    def product_detail(product_id: str):
        item = store.product(product_id)
        if not item or item.get("published") is False:
            raise HTTPException(404, "Product not found")
        related = [
            p for p in list_products(category=item["category"])["products"]
            if p["id"] != item["id"]
        ][:4]
        return {"product": item, "related": related, "images": images.VIEWS}

    @app.get("/api/products/{product_id}/images/{view}.svg")
    def product_image(product_id: str, view: int):
        item = store.product(product_id)
        if not item:
            raise HTTPException(404, "Product not found")
        return Response(
            content=images.render(item, view),
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # ---------------- 会话与导购 ----------------

    @app.post("/api/sessions", status_code=201)
    def new_session():
        return {"id": store.create_session()}

    @app.get("/api/sessions/{sid}")
    def session(sid: str):
        return get_session(sid)

    @app.post("/api/sessions/{sid}/chat")
    async def chat(sid: str, body: Chat):
        current = get_session(sid)
        constraints = {
            **current["constraints"],
            **explicit_patch(body.message),
            **body.constraints.model_dump(exclude_unset=True),
        }
        try:
            constraints = Constraints.model_validate(constraints).model_dump(
                exclude_unset=True
            )
        except ValueError as e:
            raise HTTPException(
                422, "Invalid constraints: budget outside allowed range"
            ) from e
        items = published()
        products = search(items, constraints)
        fallback = {
            "mode": "deterministic",
            "constraints": constraints,
            "products": products,
            "tool_trace": [{"name": "search_catalog", "arguments": constraints}],
            "message": f"找到 {len(products)} 件符合条件的商品。",
        }
        result = fallback
        if llm and os.environ.get("OPENAI_NEXT_API_KEY"):
            from shopping.agent import run_agent

            try:
                result = await run_agent(
                    items, current["messages"], body.message, constraints
                )
            except (ValueError, RuntimeError) as e:
                # 模型不可用时降级为确定性检索，并在响应里如实标注原因，
                # 不做任何模型生成的商品声明。
                result = {
                    **fallback,
                    "mode": "deterministic-fallback",
                    "fallback_reason": str(e),
                    "message": (
                        f"模型暂不可用（{e}），已按你的条件返回确定性检索结果："
                        f"找到 {len(products)} 件商品。"
                    ),
                }
        messages = current["messages"] + [
            {"role": "user", "content": body.message},
            {"role": "assistant", "content": result["message"]},
        ]
        if not store.save_session(
            sid,
            {"constraints": result["constraints"], "messages": messages[-20:]},
            current["revision"],
        ):
            raise HTTPException(409, "Concurrent session change; retry")
        return result

    @app.post("/api/sessions/{sid}/compare")
    def compare(sid: str, body: Compare):
        current = get_session(sid)
        eligible = {
            p["id"]: p for p in search(published(), current["constraints"])
        }
        if any(pid not in eligible for pid in body.ids):
            raise HTTPException(422, "Unknown or constraint-violating product")
        return {
            "products": [eligible[pid] for pid in dict.fromkeys(body.ids)],
            "source": "synthetic-fixture",
        }

    # ---------------- 订单 ----------------

    @app.post("/api/sessions/{sid}/orders", status_code=201)
    def create_order(sid: str, body: CreateOrder):
        get_session(sid)
        try:
            order, created = store.create_order(
                sid,
                body.request_id,
                [item.model_dump() for item in body.items],
                address=body.address.model_dump() if body.address else None,
            )
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        return {"order": order, "created": created}

    @app.get("/api/sessions/{sid}/orders")
    def order_list(sid: str):
        get_session(sid)
        return {"orders": store.orders_for(sid)}

    @app.get("/api/sessions/{sid}/orders/{order_id}")
    def order(sid: str, order_id: str):
        get_session(sid)
        result = store.order(order_id, sid)
        if result is None:
            raise HTTPException(404, "Order not found")
        return result

    @app.post("/api/sessions/{sid}/orders/{order_id}/pay")
    def pay(sid: str, order_id: str):
        """演示支付：没有接入真实支付渠道，直接标记支付成功并按订单扣减库存。"""
        get_session(sid)
        current = store.order(order_id, sid)
        if current is None:
            raise HTTPException(404, "Order not found")
        if current["status"] != "pending_payment":
            raise HTTPException(409, f"Order is {current['status']}")
        store.decrement_stock(current["items"])
        updated = store.update_order(
            order_id, status="paid", note="演示支付成功（未接入真实支付渠道）"
        )
        return {"order": updated, "payment": "demo-no-real-charge"}

    @app.post("/api/sessions/{sid}/orders/{order_id}/cancel")
    def cancel(sid: str, order_id: str):
        get_session(sid)
        current = store.order(order_id, sid)
        if current is None:
            raise HTTPException(404, "Order not found")
        if current["status"] != "pending_payment":
            raise HTTPException(409, f"Order is {current['status']}")
        return {"order": store.update_order(order_id, status="cancelled", note="用户取消")}

    # ---------------- 智能客服 ----------------

    @app.get("/api/support/faq")
    def support_faq():
        return {
            "faq": support.faq_list(),
            "suggestions": support.BASE_SUGGESTIONS,
            "note": "规则类回答均为演示规则；订单/商品信息实时查库。",
        }

    @app.post("/api/sessions/{sid}/support")
    async def support_chat(sid: str, body: SupportMessage):
        current = get_session(sid)
        answer = support.respond(
            body.message, store, sid, products=published()
        )
        answer["mode"] = "rules-and-live-data"
        if llm and os.environ.get("OPENAI_NEXT_API_KEY"):
            try:
                answer["reply"] = await support.polish(answer["reply"], body.message)
                answer["mode"] = "llm-polished"
            except (ValueError, RuntimeError, KeyError, IndexError) as e:
                answer["mode"] = "rules-and-live-data"
                answer["polish_error"] = f"{type(e).__name__}: {e}"
        store.append_support(
            sid,
            {"role": "user", "content": body.message},
            current["revision"],
        )
        latest = store.session(sid) or {}
        store.append_support(
            sid,
            {"role": "assistant", "content": answer["reply"]},
            latest.get("revision", current["revision"] + 1),
        )
        return answer

    @app.get("/api/sessions/{sid}/tickets")
    def session_tickets(sid: str):
        """用户侧：看自己这个会话的工单与人工回复（其它会话的工单拿不到）。"""
        get_session(sid)
        return {"tickets": store.tickets_for(sid)}

    # ---------------- 管理后台 ----------------

    @app.post("/api/admin/product-events", status_code=202)
    def queue(body: ProductEvent, x_admin_token: str = Header(default="")):
        require_admin(x_admin_token)
        if body.product_id not in {p["id"] for p in store.products()}:
            raise HTTPException(422, "Unknown product")
        try:
            store.queue_event(body.model_dump())
        except ValueError as e:
            raise HTTPException(409, str(e)) from e
        return {
            "event_id": body.event_id,
            "status": "queued",
            "note": "Catalog changes only after Kafka consumption",
        }

    @app.get("/api/admin/products")
    def admin_products(x_admin_token: str = Header(default="")):
        require_admin(x_admin_token)
        return {"products": store.products(), "categories": CATEGORIES}

    @app.post("/api/admin/products", status_code=201)
    def admin_create_product(
        body: ProductCreate, x_admin_token: str = Header(default="")
    ):
        require_admin(x_admin_token)
        product_id = "new-" + uuid.uuid4().hex[:8]
        created = store.create_product(product_id, body.model_dump())
        if created is None:
            raise HTTPException(409, "Product already exists")
        return {"product": created}

    @app.patch("/api/admin/products/{product_id}")
    def admin_update_product(
        product_id: str,
        body: ProductUpdate,
        x_admin_token: str = Header(default=""),
    ):
        require_admin(x_admin_token)
        updated = store.upsert_product(
            product_id, body.model_dump(exclude_unset=True)
        )
        if updated is None:
            raise HTTPException(404, "Product not found")
        return {"product": updated}

    @app.get("/api/admin/orders")
    def admin_orders(x_admin_token: str = Header(default="")):
        require_admin(x_admin_token)
        return {"orders": store.all_orders()}

    @app.get("/api/admin/tickets")
    def admin_tickets(x_admin_token: str = Header(default="")):
        require_admin(x_admin_token)
        return {"tickets": store.tickets()}

    @app.post("/api/admin/tickets/{ticket_id}/close", status_code=200)
    def admin_close_ticket(ticket_id: str, x_admin_token: str = Header(default="")):
        require_admin(x_admin_token)
        closed = store.close_ticket(ticket_id, note="客服已回复并关闭（演示）")
        if closed is None:
            raise HTTPException(404, "Ticket not found")
        return {"ticket": closed}

    @app.post("/api/admin/tickets/{ticket_id}/reply", status_code=200)
    def admin_reply_ticket(
        ticket_id: str,
        body: TicketReply,
        x_admin_token: str = Header(default=""),
    ):
        """人工客服在工单里回复；用户在右下角客服面板里能看到这条回复。"""
        require_admin(x_admin_token)
        current = store.ticket(ticket_id)
        if current is None:
            raise HTTPException(404, "Ticket not found")
        updated = store.add_ticket_message(ticket_id, body.message, role="staff")
        if body.close:
            updated = store.close_ticket(ticket_id, note="客服回复后关闭（演示）")
        # 人工回复也要进会话的客服记录，这样后台「客服会话」里能看到完整对话
        session = store.session(current["session_id"])
        if session:
            store.append_support(
                current["session_id"],
                {"role": "staff", "content": body.message},
                session["revision"],
            )
        return {"ticket": updated}

    @app.get("/api/admin/conversations")
    def admin_conversations(x_admin_token: str = Header(default="")):
        require_admin(x_admin_token)
        return {"conversations": store.support_conversations()}

    @app.post("/api/admin/orders/{order_id}/ship")
    def admin_ship(order_id: str, x_admin_token: str = Header(default="")):
        require_admin(x_admin_token)
        current = store.order(order_id)
        if current is None:
            raise HTTPException(404, "Order not found")
        if current["status"] == "pending_payment":
            raise HTTPException(409, "未支付订单不能发货")
        return {"order": store.update_order(order_id, status="shipped", note="商家已发货")}

    dist = Path(__file__).parent.parent / "frontend" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
