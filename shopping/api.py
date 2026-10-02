import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from shopping.catalog import explicit_patch, search
from shopping.store import Store


class Constraints(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    category: str | None = Field(default=None, pattern="^(headphones|keyboard|mouse)$")
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


class CreateOrder(BaseModel):
    request_id: str = Field(min_length=1, max_length=100)
    items: list[CartItem] = Field(min_length=1, max_length=20)


class ProductEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    event_id: str = Field(min_length=1, max_length=100)
    product_id: str = Field(min_length=1, max_length=100)
    version: int = Field(ge=1)
    price_cents: int = Field(ge=0)
    stock: int = Field(ge=0)


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

    app = FastAPI(title="Shopping Agent · Synthetic Catalog", lifespan=lifespan)
    app.state.store = store

    def get_session(sid):
        session = store.session(sid)
        if session is None:
            raise HTTPException(404, "Session not found")
        return session

    @app.get("/health")
    def health():
        with store.engine.connect() as c:
            c.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "database": store.engine.dialect.name,
            "catalog": "synthetic-fixture",
            "llm": bool(llm and os.environ.get("OPENAI_NEXT_API_KEY")),
            "kafka": "separate-worker-not-probed",
        }

    @app.get("/api/catalog")
    def catalog():
        return {"products": search(store.products(), {}), "source": "synthetic-fixture"}

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
        products = search(store.products(), constraints)
        result = {
            "mode": "deterministic",
            "constraints": constraints,
            "products": products,
            "tool_trace": [{"name": "search_catalog", "arguments": constraints}],
            "message": f"找到 {len(products)} 件符合条件的合成示例商品。",
        }
        if llm and os.environ.get("OPENAI_NEXT_API_KEY"):
            from shopping.agent import run_agent

            try:
                result = await run_agent(
                    store.products(), current["messages"], body.message, constraints
                )
            except (ValueError, RuntimeError) as e:
                raise HTTPException(502, str(e)) from e
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
            p["id"]: p for p in search(store.products(), current["constraints"])
        }
        if any(pid not in eligible for pid in body.ids):
            raise HTTPException(422, "Unknown or constraint-violating product")
        return {
            "products": [eligible[pid] for pid in dict.fromkeys(body.ids)],
            "source": "synthetic-fixture",
        }

    @app.post("/api/sessions/{sid}/orders", status_code=201)
    def create_order(sid: str, body: CreateOrder):
        get_session(sid)
        try:
            order, created = store.create_order(
                sid, body.request_id, [item.model_dump() for item in body.items]
            )
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        return {"order": order, "created": created}

    @app.get("/api/sessions/{sid}/orders/{order_id}")
    def order(sid: str, order_id: str):
        get_session(sid)
        result = store.order(order_id, sid)
        if result is None:
            raise HTTPException(404, "Order not found")
        return result

    @app.post("/api/admin/product-events", status_code=202)
    def queue(body: ProductEvent, x_admin_token: str = Header(default="")):
        import secrets

        expected = os.environ.get("ADMIN_TOKEN")
        if not expected or not secrets.compare_digest(x_admin_token, expected):
            raise HTTPException(403, "Admin token required")
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

    dist = Path(__file__).parent.parent / "frontend" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
