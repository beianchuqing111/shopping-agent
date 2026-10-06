import uuid

from sqlalchemy import (
    JSON,
    Column,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from shopping.catalog_data import PRODUCTS

metadata = MetaData()
products = Table(
    "products",
    metadata,
    Column("id", String, primary_key=True),
    Column("data", JSON, nullable=False),
    Column("version", Integer, nullable=False),
)
sessions = Table(
    "sessions",
    metadata,
    Column("id", String, primary_key=True),
    Column("data", JSON, nullable=False),
    Column("revision", Integer, nullable=False, default=0),
)
processed = Table(
    "processed_events",
    metadata,
    Column("id", String, primary_key=True),
    Column("status", String, nullable=False),
)
outbox = Table(
    "outbox",
    metadata,
    Column("id", String, primary_key=True),
    Column("payload", JSON, nullable=False),
    Column("status", String, nullable=False),
)
orders = Table(
    "orders",
    metadata,
    Column("id", String, primary_key=True),
    Column("session_id", String, nullable=False),
    Column("request_id", String, nullable=False, unique=True),
    Column("data", JSON, nullable=False),
)

# 自建演示商品库，定义在 shopping/catalog_data.py；测试通过 FIXTURES 引用它。
FIXTURES = PRODUCTS

ORDER_STATUSES = ("pending_payment", "paid", "shipped", "completed", "cancelled")
FREE_SHIPPING_CENTS = 9900
SHIPPING_CENTS = 1000


class Store:
    def __init__(self, url):
        self.engine = create_engine(
            url,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False}
            if url.startswith("sqlite")
            else {},
        )

    def insert(self, table):
        return (
            pg_insert(table)
            if self.engine.dialect.name == "postgresql"
            else sqlite_insert(table)
        )

    def initialize(self):
        """建表并写入种子商品。

        规则：缺失的行插入；已存在且**仍属于种子数据**的行，在种子版本变化时刷新。
        仍属于种子数据的判定：version == 1（从未被后台改过），或数据里还没有
        seed_revision 字段（旧版本种子写入的行）。被后台改过的行保持不动，
        不会覆盖运营数据。
        """
        metadata.create_all(self.engine)
        with self.engine.begin() as c:
            existing = {
                row["id"]: row
                for row in c.execute(
                    select(products.c.id, products.c.data, products.c.version)
                ).mappings()
            }
            for p in FIXTURES:
                row = existing.get(p["id"])
                if row is None:
                    c.execute(
                        self.insert(products)
                        .values(id=p["id"], data=p, version=1)
                        .on_conflict_do_nothing()
                    )
                    continue
                stored = row["data"] or {}
                seed_owned = row["version"] == 1 or "seed_revision" not in stored
                if seed_owned and stored.get("seed_revision") != p.get(
                    "seed_revision"
                ):
                    c.execute(
                        update(products)
                        .where(products.c.id == p["id"])
                        .values(data=p, version=1)
                    )

    def products(self):
        with self.engine.connect() as c:
            return list(
                c.execute(select(products.c.data).order_by(products.c.id)).scalars()
            )

    def product(self, product_id):
        with self.engine.connect() as c:
            return c.execute(
                select(products.c.data).where(products.c.id == product_id)
            ).scalar()

    def upsert_product(self, product_id, changes):
        """管理后台写入商品字段；版本号自增，保证前端能看见变化。"""
        with self.engine.begin() as c:
            row = (
                c.execute(select(products).where(products.c.id == product_id))
                .mappings()
                .first()
            )
            if not row:
                return None
            data = {**row["data"]}
            for key in (
                "title",
                "brand",
                "category",
                "price_cents",
                "list_price_cents",
                "stock",
                "published",
                "description",
                "features",
                "tags",
            ):
                if key in changes and changes[key] is not None:
                    data[key] = changes[key]
            version = row["version"] + 1
            data["version"] = version
            c.execute(
                update(products)
                .where(products.c.id == product_id)
                .values(data=data, version=version)
            )
            return data

    def create_product(self, product_id, data):
        with self.engine.begin() as c:
            existing = c.execute(
                select(products.c.id).where(products.c.id == product_id)
            ).scalar()
            if existing:
                return None
            payload = {
                "id": product_id,
                "sku": data.get("sku") or product_id.upper(),
                "title": data["title"],
                "brand": data.get("brand") or "自营",
                "category": data["category"],
                "price_cents": data["price_cents"],
                "list_price_cents": data.get("list_price_cents") or data["price_cents"],
                "stock": data.get("stock", 0),
                "version": 1,
                "published": data.get("published", True),
                "features": data.get("features") or [],
                "description": data.get("description") or "",
                "specs": data.get("specs") or [],
                "rating": data.get("rating") or 5.0,
                "reviews": data.get("reviews") or 0,
                "sold": data.get("sold") or 0,
                "tags": data.get("tags") or [],
            }
            c.execute(products.insert().values(
                id=product_id, data=payload, version=1
            ))
            return payload

    def create_session(self):
        sid = str(uuid.uuid4())
        with self.engine.begin() as c:
            c.execute(
                sessions.insert().values(
                    id=sid, data={"constraints": {}, "messages": []}, revision=0
                )
            )
        return sid

    def session(self, sid):
        with self.engine.connect() as c:
            row = (
                c.execute(select(sessions).where(sessions.c.id == sid))
                .mappings()
                .first()
            )
            return {**row["data"], "revision": row["revision"]} if row else None

    def save_session(self, sid, data, revision):
        with self.engine.begin() as c:
            count = c.execute(
                update(sessions)
                .where(sessions.c.id == sid, sessions.c.revision == revision)
                .values(data=data, revision=revision + 1)
            ).rowcount
            return count == 1

    def shipping_cents(self, subtotal_cents):
        return 0 if subtotal_cents >= FREE_SHIPPING_CENTS else SHIPPING_CENTS

    def create_order(self, session_id, request_id, items, address=None):
        """Create an immutable server-side price and stock snapshot."""
        with self.engine.begin() as c:
            existing = c.execute(
                select(orders.c.data).where(orders.c.request_id == request_id)
            ).scalar()
            if existing is not None:
                return existing, False
            catalog = {p["id"]: p for p in self.products()}
            normalized = []
            total = 0
            for item in items:
                product = catalog.get(item["product_id"])
                quantity = item["quantity"]
                if not product or quantity < 1 or quantity > product["stock"]:
                    raise ValueError("商品不存在、已缺货或购买数量超过库存")
                if product.get("published") is False:
                    raise ValueError("商品已下架")
                line_total = product["price_cents"] * quantity
                total += line_total
                normalized.append({
                    "product_id": product["id"],
                    "sku": product.get("sku"),
                    "title": product["title"],
                    "quantity": quantity,
                    "unit_price_cents": product["price_cents"],
                    "line_total_cents": line_total,
                    "version": product["version"],
                })
            shipping = self.shipping_cents(total)
            order = {
                "id": str(uuid.uuid4()),
                "order_no": "SO" + uuid.uuid4().hex[:12].upper(),
                "session_id": session_id,
                "request_id": request_id,
                "status": "pending_payment",
                "items": normalized,
                "subtotal_cents": total,
                "shipping_cents": shipping,
                "total_cents": total + shipping,
                "address": address,
                "history": [{"status": "pending_payment", "note": "订单已创建，等待支付"}],
                "source": "synthetic-fixture",
            }
            c.execute(orders.insert().values(
                id=order["id"], session_id=session_id,
                request_id=request_id, data=order
            ))
            return order, True

    def order(self, order_id, session_id=None):
        with self.engine.connect() as c:
            query = select(orders.c.data).where(orders.c.id == order_id)
            if session_id is not None:
                query = query.where(orders.c.session_id == session_id)
            return c.execute(query).scalar()

    def orders_for(self, session_id):
        with self.engine.connect() as c:
            rows = list(
                c.execute(
                    select(orders.c.data).where(orders.c.session_id == session_id)
                ).scalars()
            )
        return sorted(rows, key=lambda o: o["id"], reverse=True)

    def all_orders(self):
        with self.engine.connect() as c:
            rows = list(c.execute(select(orders.c.data)).scalars())
        return sorted(rows, key=lambda o: o["id"], reverse=True)

    def update_order(self, order_id, status=None, note=None, address=None):
        with self.engine.begin() as c:
            row = (
                c.execute(select(orders).where(orders.c.id == order_id))
                .mappings()
                .first()
            )
            if not row:
                return None
            data = {**row["data"]}
            if address is not None:
                data["address"] = address
            if status:
                data["status"] = status
                data.setdefault("history", []).append(
                    {"status": status, "note": note or status}
                )
            c.execute(update(orders).where(orders.c.id == order_id).values(data=data))
            return data

    def decrement_stock(self, items):
        """支付成功后真实扣减库存，永不超过现有库存。"""
        with self.engine.begin() as c:
            for item in items:
                row = (
                    c.execute(
                        select(products).where(products.c.id == item["product_id"])
                    )
                    .mappings()
                    .first()
                )
                if not row:
                    continue
                data = {**row["data"]}
                stock = max(0, int(data["stock"]) - int(item["quantity"]))
                data["stock"] = stock
                data["sold"] = int(data.get("sold") or 0) + int(item["quantity"])
                version = row["version"] + 1
                data["version"] = version
                c.execute(
                    update(products)
                    .where(products.c.id == item["product_id"])
                    .values(data=data, version=version)
                )

    def queue_event(self, event):
        with self.engine.begin() as c:
            existing = c.execute(
                select(outbox.c.payload).where(outbox.c.id == event["event_id"])
            ).scalar()
            if existing is not None:
                if existing != event:
                    raise ValueError("event_id already used with a different payload")
                return False
            c.execute(
                self.insert(outbox)
                .values(id=event["event_id"], payload=event, status="pending")
                .on_conflict_do_nothing()
            )
            return True

    def apply_event(self, event):
        with self.engine.begin() as c:
            inserted = c.execute(
                self.insert(processed)
                .values(id=event["event_id"], status="processing")
                .on_conflict_do_nothing()
                .returning(processed.c.id)
            ).scalar()
            if not inserted:
                return "duplicate"
            row = (
                c.execute(
                    select(products)
                    .where(products.c.id == event["product_id"])
                    .with_for_update()
                )
                .mappings()
                .first()
            )
            if not row:
                raise ValueError("unknown product")
            status = "stale"
            if event["version"] > row["version"]:
                data = {
                    **row["data"],
                    **{k: event[k] for k in ("price_cents", "stock", "version")},
                }
                c.execute(
                    update(products)
                    .where(products.c.id == event["product_id"])
                    .values(data=data, version=event["version"])
                )
                status = "applied"
            c.execute(
                update(processed)
                .where(processed.c.id == event["event_id"])
                .values(status=status)
            )
            return status
