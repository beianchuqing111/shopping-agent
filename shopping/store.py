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

FIXTURES = [
    {
        "id": "demo-h1",
        "title": "Demo Quiet 01",
        "category": "headphones",
        "price_cents": 9900,
        "stock": 12,
        "brand": "Fixture",
        "version": 1,
        "features": ["wireless", "lightweight"],
    },
    {
        "id": "demo-h2",
        "title": "Demo Studio 02",
        "category": "headphones",
        "price_cents": 24900,
        "stock": 5,
        "brand": "Fixture",
        "version": 1,
        "features": ["wired", "over-ear"],
    },
    {
        "id": "demo-k1",
        "title": "Demo Type 01",
        "category": "keyboard",
        "price_cents": 15900,
        "stock": 8,
        "brand": "Fixture",
        "version": 1,
        "features": ["mechanical", "compact"],
    },
    {
        "id": "demo-m1",
        "title": "Demo Move 01",
        "category": "mouse",
        "price_cents": 7900,
        "stock": 20,
        "brand": "Fixture",
        "version": 1,
        "features": ["wireless", "ergonomic"],
    },
    {
        "id": "demo-h3",
        "title": "Demo Quiet 03",
        "category": "headphones",
        "price_cents": 6900,
        "stock": 0,
        "brand": "Fixture",
        "version": 1,
        "features": ["wired"],
    },
]


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
        metadata.create_all(self.engine)
        with self.engine.begin() as c:
            for p in FIXTURES:
                c.execute(
                    self.insert(products)
                    .values(id=p["id"], data=p, version=1)
                    .on_conflict_do_nothing()
                )

    def products(self):
        with self.engine.connect() as c:
            return list(
                c.execute(select(products.c.data).order_by(products.c.id)).scalars()
            )

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

    def create_order(self, session_id, request_id, items):
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
                line_total = product["price_cents"] * quantity
                total += line_total
                normalized.append({
                    "product_id": product["id"],
                    "title": product["title"],
                    "quantity": quantity,
                    "unit_price_cents": product["price_cents"],
                    "line_total_cents": line_total,
                    "version": product["version"],
                })
            order = {
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "request_id": request_id,
                "status": "pending_payment",
                "items": normalized,
                "total_cents": total,
                "source": "synthetic-fixture",
            }
            c.execute(orders.insert().values(
                id=order["id"], session_id=session_id,
                request_id=request_id, data=order
            ))
            return order, True

    def order(self, order_id, session_id):
        with self.engine.connect() as c:
            return c.execute(
                select(orders.c.data).where(
                    orders.c.id == order_id, orders.c.session_id == session_id
                )
            ).scalar()

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
