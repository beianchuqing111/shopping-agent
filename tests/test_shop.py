"""商城功能测试：商品浏览、详情、图片、结算、支付、订单流转与管理后台。"""

import pytest
from fastapi.testclient import TestClient

from shopping.api import create_app
from shopping.images import render


@pytest.fixture()
def client(tmp_path):
    with TestClient(create_app(f"sqlite:///{tmp_path}/shop.db", llm=False)) as c:
        yield c


def new_session(client):
    return client.post("/api/sessions").json()["id"]


def test_catalog_has_multiple_categories_and_products(client):
    data = client.get("/api/products", params={"page_size": 60}).json()
    assert data["total"] > 40
    keys = {c["key"] for c in data["categories"]}
    assert {"headphones", "keyboard", "mouse", "monitor"} <= keys
    assert all(p["stock"] >= 0 for p in data["products"])


def test_search_filter_sort_and_pagination(client):
    page1 = client.get(
        "/api/products", params={"category": "keyboard", "page_size": 3, "page": 1}
    ).json()
    assert len(page1["products"]) == 3
    assert all(p["category"] == "keyboard" for p in page1["products"])
    page2 = client.get(
        "/api/products", params={"category": "keyboard", "page_size": 3, "page": 2}
    ).json()
    assert {p["id"] for p in page1["products"]} & {p["id"] for p in page2["products"]} == set()

    cheap = client.get(
        "/api/products", params={"sort": "price_asc", "page_size": 5}
    ).json()["products"]
    prices = [p["price_cents"] for p in cheap]
    assert prices == sorted(prices)

    hit = client.get("/api/products", params={"q": "骨传导"}).json()
    assert [p["id"] for p in hit["products"]] == ["hp-005"]

    ranged = client.get(
        "/api/products", params={"price_min": 10000, "price_max": 20000, "page_size": 60}
    ).json()["products"]
    assert ranged and all(10000 <= p["price_cents"] <= 20000 for p in ranged)


def test_product_detail_related_and_404(client):
    data = client.get("/api/products/hp-002").json()
    assert data["product"]["title"].startswith("汀澜 Aurora Pro")
    assert data["product"]["specs"]
    assert all(p["category"] == "headphones" for p in data["related"])
    assert data["images"] == 3
    assert client.get("/api/products/nope-000").status_code == 404


def test_product_images_are_generated_svg(client):
    response = client.get("/api/products/hp-002/images/1.svg")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert "<svg" in response.text
    assert "四分之三视图" in response.text
    assert client.get("/api/products/hp-002/images/9.svg").status_code == 200


def test_categories_report_counts(client):
    data = client.get("/api/categories").json()
    headphones = next(c for c in data["categories"] if c["key"] == "headphones")
    assert headphones["count"] >= 10
    assert all(c["count"] > 0 for c in data["categories"])


def test_checkout_with_address_totals_and_shipping(client):
    sid = new_session(client)
    payload = {
        "request_id": "addr-1",
        "items": [{"product_id": "acc-004", "quantity": 1}],
        "address": {
            "recipient": "张同学",
            "phone": "13800000000",
            "detail": "广东省广州市天河区某某路 1 号 101 室",
        },
    }
    order = client.post(f"/api/sessions/{sid}/orders", json=payload).json()["order"]
    assert order["subtotal_cents"] == 2900
    assert order["shipping_cents"] == 1000
    assert order["total_cents"] == 3900
    assert order["address"]["recipient"] == "张同学"
    assert order["order_no"].startswith("SO")

    free = client.post(
        f"/api/sessions/{sid}/orders",
        json={"request_id": "addr-2", "items": [{"product_id": "acc-004", "quantity": 5}]},
    ).json()["order"]
    assert free["subtotal_cents"] == 14500
    assert free["shipping_cents"] == 0


def test_payment_marks_paid_and_decrements_stock(client):
    sid = new_session(client)
    before = client.get("/api/products/hp-002").json()["product"]
    order = client.post(
        f"/api/sessions/{sid}/orders",
        json={"request_id": "pay-1", "items": [{"product_id": "hp-002", "quantity": 2}]},
    ).json()["order"]
    assert order["status"] == "pending_payment"

    paid = client.post(f"/api/sessions/{sid}/orders/{order['id']}/pay").json()
    assert paid["payment"] == "demo-no-real-charge"
    assert paid["order"]["status"] == "paid"
    assert [h["status"] for h in paid["order"]["history"]] == ["pending_payment", "paid"]

    after = client.get("/api/products/hp-002").json()["product"]
    assert after["stock"] == before["stock"] - 2
    assert after["sold"] == before["sold"] + 2
    assert client.post(f"/api/sessions/{sid}/orders/{order['id']}/pay").status_code == 409


def test_cancel_and_order_list(client):
    sid = new_session(client)
    kept = client.post(
        f"/api/sessions/{sid}/orders",
        json={"request_id": "list-1", "items": [{"product_id": "demo-m1", "quantity": 1}]},
    ).json()["order"]
    dropped = client.post(
        f"/api/sessions/{sid}/orders",
        json={"request_id": "list-2", "items": [{"product_id": "demo-m1", "quantity": 1}]},
    ).json()["order"]
    assert client.post(f"/api/sessions/{sid}/orders/{dropped['id']}/cancel").json()[
        "order"
    ]["status"] == "cancelled"
    listed = client.get(f"/api/sessions/{sid}/orders").json()["orders"]
    assert {o["id"] for o in listed} == {kept["id"], dropped["id"]}
    assert client.get(f"/api/sessions/{sid}/orders/{kept['id']}").json()["status"] == "pending_payment"


def test_admin_requires_token_and_can_manage_products(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    assert client.get("/api/admin/products").status_code == 403
    assert (
        client.get(
            "/api/admin/products", headers={"X-Admin-Token": "wrong"}
        ).status_code
        == 403
    )
    headers = {"X-Admin-Token": "test-admin"}

    created = client.post(
        "/api/admin/products",
        headers=headers,
        json={
            "title": "云雀 新品音箱 X1",
            "category": "speaker",
            "brand": "云雀",
            "price_cents": 12900,
            "stock": 7,
        },
    )
    assert created.status_code == 201
    new_id = created.json()["product"]["id"]
    assert client.get(f"/api/products/{new_id}").status_code == 200

    updated = client.patch(
        f"/api/admin/products/{new_id}",
        headers=headers,
        json={"price_cents": 9900, "stock": 3},
    ).json()["product"]
    assert updated["price_cents"] == 9900
    assert updated["version"] == 2

    assert (
        client.patch(
            f"/api/admin/products/{new_id}",
            headers=headers,
            json={"published": False},
        ).json()["product"]["published"]
        is False
    )
    assert client.get(f"/api/products/{new_id}").status_code == 404
    assert new_id not in {
        p["id"]
        for p in client.get("/api/products", params={"page_size": 60}).json()["products"]
    }
    listed = client.get("/api/admin/products", headers=headers).json()["products"]
    assert new_id in {p["id"] for p in listed}
    assert client.patch("/api/admin/products/missing", headers=headers, json={"stock": 1}).status_code == 404


def test_admin_ship_requires_paid_order(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    headers = {"X-Admin-Token": "test-admin"}
    sid = new_session(client)
    order = client.post(
        f"/api/sessions/{sid}/orders",
        json={"request_id": "ship-1", "items": [{"product_id": "demo-k1", "quantity": 1}]},
    ).json()["order"]
    assert client.post(f"/api/admin/orders/{order['id']}/ship", headers=headers).status_code == 409
    client.post(f"/api/sessions/{sid}/orders/{order['id']}/pay")
    shipped = client.post(f"/api/admin/orders/{order['id']}/ship", headers=headers).json()
    assert shipped["order"]["status"] == "shipped"
    assert [o["id"] for o in client.get("/api/admin/orders", headers=headers).json()["orders"]] == [
        order["id"]
    ]


def test_ordering_out_of_stock_product_is_rejected(client):
    sid = new_session(client)
    response = client.post(
        f"/api/sessions/{sid}/orders",
        json={"request_id": "oos", "items": [{"product_id": "demo-h3", "quantity": 1}]},
    )
    assert response.status_code == 422


def test_guide_falls_back_to_deterministic_search_when_model_unavailable(
    tmp_path, monkeypatch
):
    """模型不可用时不能 502 掉整个商城，必须降级为确定性检索并如实标注。"""
    import shopping.agent as agent_module

    async def broken(*args, **kwargs):
        raise RuntimeError("LLM provider returned HTTP 401")

    monkeypatch.setattr(agent_module, "run_agent", broken)
    monkeypatch.setenv("OPENAI_NEXT_API_KEY", "test-key-not-used")
    with TestClient(create_app(f"sqlite:///{tmp_path}/fallback.db", llm=True)) as c:
        sid = c.post("/api/sessions").json()["id"]
        response = c.post(
            f"/api/sessions/{sid}/chat", json={"message": "300元以内的键盘"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["mode"] == "deterministic-fallback"
        assert "HTTP 401" in body["fallback_reason"]
        assert body["products"], "降级后仍应返回检索结果"
        assert all(p["price_cents"] <= 30000 for p in body["products"])
        assert body["constraints"]["category"] == "keyboard"


def test_seed_refresh_updates_untouched_rows_but_keeps_admin_edits(tmp_path):
    """种子数据更新时：没被后台改过的行刷新，被改过的行保持不动。"""
    from sqlalchemy import update

    from shopping.store import FIXTURES, Store
    from shopping.store import products as products_table

    url = f"sqlite:///{tmp_path}/seed.db"
    store = Store(url)
    store.initialize()
    target = "hp-003"

    # 模拟“旧种子”：版本一致但内容过时
    stale = {
        **next(p for p in FIXTURES if p["id"] == target),
        "title": "旧的演示标题",
        "seed_revision": 1,
    }
    with store.engine.begin() as c:
        c.execute(
            update(products_table)
            .where(products_table.c.id == target)
            .values(data=stale, version=1)
        )
    # 模拟后台编辑过的行（version > 1，带 seed_revision）
    store.upsert_product("hp-006", {"price_cents": 12345})
    # 模拟旧版本种子写入的行（没有 seed_revision，且被事件更新过导致 version > 1）
    legacy = {k: v for k, v in next(p for p in FIXTURES if p["id"] == "demo-m1").items() if k != "seed_revision"}
    legacy["title"] = "旧的 Demo Move"
    with store.engine.begin() as c:
        c.execute(
            update(products_table)
            .where(products_table.c.id == "demo-m1")
            .values(data=legacy, version=2)
        )

    store.initialize()

    refreshed = store.product(target)
    assert refreshed["title"] != "旧的演示标题", "未编辑的种子行应被刷新"
    assert refreshed["seed_revision"] == stale["seed_revision"] + 1
    assert store.product("demo-m1")["title"] != "旧的 Demo Move", "旧的种子行也应被迁移刷新"
    assert store.product("hp-006")["price_cents"] == 12345, "后台改过的行不能被覆盖"


def test_generated_image_is_deterministic_and_escapes_text():
    product = {"id": "x-1", "sku": "X-1", "brand": "A&B", "category": "mouse", "title": "t"}
    assert render(product, 0) == render(product, 0)
    assert "A&amp;B" in render(product, 0)
    assert 'viewBox="0 0 400 400"' in render(product, 2)
