def test_search_enforces_budget_stock_and_evidence():
    from shopping.catalog import search

    products = [
        {
            "id": "a",
            "title": "Demo A",
            "category": "headphones",
            "price_cents": 9900,
            "stock": 1,
            "brand": "Fixture",
            "version": 1,
        },
        {
            "id": "b",
            "title": "Demo B",
            "category": "headphones",
            "price_cents": 19900,
            "stock": 0,
            "brand": "Fixture",
            "version": 1,
        },
    ]
    result = search(products, {"category": "headphones", "max_price_cents": 10000})
    assert [p["id"] for p in result] == ["a"]
    assert result[0]["evidence"] == {
        "source": "synthetic-fixture",
        "product_id": "a",
        "version": 1,
    }


def test_api_sessions_merge_constraints_and_compare(tmp_path):
    from fastapi.testclient import TestClient

    from shopping.api import create_app

    with TestClient(create_app(f"sqlite:///{tmp_path}/test.db", llm=False)) as client:
        a = client.post("/api/sessions").json()["id"]
        b = client.post("/api/sessions").json()["id"]
        first = client.post(
            f"/api/sessions/{a}/chat",
            json={
                "message": "headphones",
                "constraints": {"category": "headphones", "max_price_cents": 10000},
            },
        )
        assert first.status_code == 200
        assert len(first.json()["products"]) == 1
        second = client.post(
            f"/api/sessions/{a}/chat", json={"message": "still same budget"}
        ).json()
        assert second["constraints"]["max_price_cents"] == 10000
        assert client.get(f"/api/sessions/{b}").json()["constraints"] == {}
        assert (
            client.post(
                f"/api/sessions/{a}/compare", json={"ids": ["demo-h1", "demo-h2"]}
            ).status_code
            == 422
        )
        assert (
            client.post(f"/api/sessions/{a}/compare", json={"ids": ["demo-h1"]}).json()[
                "products"
            ][0]["evidence"]["source"]
            == "synthetic-fixture"
        )
        assert client.get("/api/sessions/not-a-session").status_code == 404


def test_product_events_are_idempotent_and_version_ordered(tmp_path):
    from shopping.store import Store

    s = Store(f"sqlite:///{tmp_path}/events.db")
    s.initialize()
    event = {
        "event_id": "e1",
        "product_id": "demo-h1",
        "version": 3,
        "price_cents": 8800,
        "stock": 4,
    }
    assert s.apply_event(event) == "applied"
    assert s.apply_event(event) == "duplicate"
    assert (
        s.apply_event({**event, "event_id": "e2", "version": 2, "price_cents": 100})
        == "stale"
    )
    assert s.products()[0]["price_cents"] == 8800


def test_reused_event_id_cannot_change_payload(tmp_path):
    from shopping.store import Store

    s = Store(f"sqlite:///{tmp_path}/event-id.db")
    s.initialize()
    event = {"event_id": "same", "product_id": "demo-h1", "version": 2,
             "price_cents": 8800, "stock": 4}
    assert s.queue_event(event) is True
    assert s.queue_event(event) is False
    try:
        s.queue_event({**event, "stock": 99})
    except ValueError:
        pass
    else:
        raise AssertionError("payload mutation with reused event_id was accepted")


def test_agent_executes_tools_and_never_relaxes_existing_budget():
    import asyncio

    from shopping.agent import execute_tool
    from shopping.store import FIXTURES

    result, constraints = execute_tool(
        "search_catalog",
        {"category": "headphones", "max_price_cents": 50000},
        FIXTURES,
        {"max_price_cents": 10000},
    )
    assert constraints["max_price_cents"] == 10000
    assert [p["id"] for p in result["products"]] == ["demo-h1"]
    import httpx

    from shopping.agent import run_agent

    calls = []

    def respond(request):
        import json

        payload = json.loads(request.content)
        calls.append(payload)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "t1",
                                    "type": "function",
                                    "function": {
                                        "name": "search_catalog",
                                        "arguments": '{"category":"headphones","max_price_cents":10000}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )

    result = asyncio.run(
        run_agent(
            FIXTURES,
            [],
            "100元以内耳机",
            {},
            transport=httpx.MockTransport(respond),
            api_key="test-only",
        )
    )
    assert result["mode"] == "llm-tools"
    assert result["products"][0]["id"] == "demo-h1"
    assert calls[0]["tools"][0]["function"]["name"] == "search_catalog"


def test_admin_uses_header_not_query(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from shopping.api import create_app

    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    event = {
        "event_id": "admin-event",
        "product_id": "demo-h1",
        "version": 2,
        "price_cents": 5000,
        "stock": 1,
    }
    with TestClient(create_app(f"sqlite:///{tmp_path}/admin.db", llm=False)) as client:
        assert (
            client.post(
                "/api/admin/product-events?token=test-admin", json=event
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/admin/product-events",
                json=event,
                headers={"X-Admin-Token": "test-admin"},
            ).status_code
            == 202
        )


def test_explicit_chat_edits_budget_category_and_preserves_followup(tmp_path):
    from fastapi.testclient import TestClient

    from shopping.api import create_app

    with TestClient(create_app(f"sqlite:///{tmp_path}/turns.db", llm=False)) as c:
        sid = c.post("/api/sessions").json()["id"]
        url = f"/api/sessions/{sid}/chat"
        assert c.post(url, json={"message": "100元以内耳机"}).json()["constraints"] == {
            "category": "headphones",
            "max_price_cents": 10000,
        }
        assert (
            c.post(url, json={"message": "预算改成300元"}).json()["constraints"][
                "max_price_cents"
            ]
            == 30000
        )
        assert (
            c.post(url, json={"message": "换成鼠标"}).json()["constraints"]["category"]
            == "mouse"
        )
        assert c.post(url, json={"message": "还有吗"}).json()["constraints"] == {
            "category": "mouse",
            "max_price_cents": 30000,
        }


def test_extreme_natural_budget_returns_validation_error(tmp_path):
    from fastapi.testclient import TestClient

    from shopping.api import create_app

    with TestClient(create_app(f"sqlite:///{tmp_path}/invalid.db", llm=False)) as c:
        sid = c.post("/api/sessions").json()["id"]
        assert (
            c.post(
                f"/api/sessions/{sid}/chat", json={"message": "预算999999999元"}
            ).status_code
            == 422
        )


def test_order_uses_server_price_snapshot_and_is_idempotent(tmp_path):
    from fastapi.testclient import TestClient

    from shopping.api import create_app

    with TestClient(create_app(f"sqlite:///{tmp_path}/orders.db", llm=False)) as c:
        sid = c.post("/api/sessions").json()["id"]
        payload = {"request_id": "checkout-1", "items": [{"product_id": "demo-h1", "quantity": 2}]}
        first = c.post(f"/api/sessions/{sid}/orders", json=payload)
        assert first.status_code == 201
        order = first.json()["order"]
        assert order["total_cents"] == 19800
        assert order["items"][0]["unit_price_cents"] == 9900
        retry = c.post(f"/api/sessions/{sid}/orders", json=payload)
        assert retry.status_code == 201
        assert retry.json()["created"] is False
        assert retry.json()["order"]["id"] == order["id"]
        assert c.get(f"/api/sessions/{sid}/orders/{order['id']}").json()["id"] == order["id"]


def test_order_rejects_overstocked_item(tmp_path):
    from fastapi.testclient import TestClient

    from shopping.api import create_app

    with TestClient(create_app(f"sqlite:///{tmp_path}/orders-errors.db", llm=False)) as c:
        sid = c.post("/api/sessions").json()["id"]
        response = c.post(
            f"/api/sessions/{sid}/orders",
            json={"request_id": "bad", "items": [{"product_id": "demo-h1", "quantity": 99}]},
        )
        assert response.status_code == 422
