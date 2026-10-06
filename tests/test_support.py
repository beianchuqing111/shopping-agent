"""智能客服测试：意图识别、实时订单/商品查询、知识库、转人工工单与降级。"""

import pytest
from fastapi.testclient import TestClient

from shopping.api import create_app


@pytest.fixture()
def client(tmp_path):
    with TestClient(create_app(f"sqlite:///{tmp_path}/support.db", llm=False)) as c:
        yield c


def new_session(client):
    return client.post("/api/sessions").json()["id"]


def ask(client, sid, message):
    response = client.post(f"/api/sessions/{sid}/support", json={"message": message})
    assert response.status_code == 200, response.text
    return response.json()


def place_order(client, sid, request_id="s1", product_id="hp-002", quantity=1):
    return client.post(
        f"/api/sessions/{sid}/orders",
        json={"request_id": request_id, "items": [{"product_id": product_id, "quantity": quantity}]},
    ).json()["order"]


def test_faq_endpoint_lists_quick_questions(client):
    data = client.get("/api/support/faq").json()
    questions = [item["question"] for item in data["faq"]]
    assert "运费怎么算？" in questions
    assert "可以退货吗？怎么退？" in questions
    assert data["suggestions"]
    assert "演示规则" in data["note"]


def test_order_lookup_uses_live_data_and_returns_card(client):
    sid = new_session(client)
    order = place_order(client, sid, "sup-1")
    answer = ask(client, sid, "我的订单现在什么状态？")
    assert answer["intent"] == "order"
    assert order["order_no"] in answer["reply"]
    assert "待支付" in answer["reply"]
    assert answer["cards"][0]["type"] == "order"
    assert answer["cards"][0]["order_no"] == order["order_no"]
    assert answer["cards"][0]["link"] == f"/order/{order['id']}"

    paid = client.post(f"/api/sessions/{sid}/orders/{order['id']}/pay").json()["order"]
    assert paid["status"] == "paid"
    after = ask(client, sid, f"{order['order_no']} 到哪了？")
    assert "已支付" in after["reply"]
    assert after["cards"][0]["status"] == "paid"


def test_order_query_without_orders_guides_to_buy(client):
    sid = new_session(client)
    answer = ask(client, sid, "帮我查下物流")
    assert answer["intent"] == "order"
    assert "还没有订单" in answer["reply"]
    assert answer["needs_human"] is False


def test_unknown_order_number_escalates_to_human(client):
    sid = new_session(client)
    answer = ask(client, sid, "订单 SOABCDEF123456 到哪了")
    assert answer["needs_human"] is True
    assert "没查到订单号" in answer["reply"]
    assert answer["ticket"]["no"].startswith("TK"), "查不到的单号要自动建工单"


def test_orders_are_isolated_per_session(client):
    a = new_session(client)
    b = new_session(client)
    order = place_order(client, a, "iso-1")
    answer = ask(client, b, f"{order['order_no']} 到哪了")
    assert "没查到订单号" in answer["reply"], "不能查到别的会话的订单"
    assert answer["needs_human"] is True


def test_product_and_stock_questions_hit_live_catalog(client):
    sid = new_session(client)
    answer = ask(client, sid, "便携屏多少钱？")
    assert answer["cards"] and answer["cards"][0]["type"] == "product"
    assert "拾叶 Portable" in answer["reply"]
    assert answer["cards"][0]["price_cents"] > 0

    stock = ask(client, sid, "汀澜 Wired 03 缺货了怎么办")
    assert stock["needs_human"] is True
    assert "工单" in stock["reply"]


def test_fee_and_return_answers_come_from_knowledge_base(client):
    sid = new_session(client)
    fee = ask(client, sid, "运费怎么算的？")
    assert fee["intent"] == "faq:shipping-fee"
    assert "满 ¥99 免运费" in fee["reply"]
    other = ask(client, sid, "拆封了还能退货吗")
    assert other["intent"] == "faq:return"
    assert "7 天无理由" in other["reply"]


def test_human_handoff_creates_ticket_visible_in_admin(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    headers = {"X-Admin-Token": "test-admin"}
    sid = new_session(client)
    order = place_order(client, sid, "ticket-1")
    answer = ask(client, sid, "我要转人工，投诉这个订单")
    assert answer["needs_human"] is True
    assert answer["ticket"]["no"].startswith("TK")
    assert answer["ticket"]["status"] == "open"

    listed = client.get("/api/admin/tickets", headers=headers).json()["tickets"]
    assert len(listed) == 1
    ticket = listed[0]
    assert ticket["status"] == "open"
    assert order["order_no"] in str(ticket["messages"]), "工单应带上订单上下文"
    assert any(m["content"].startswith("（我的最近订单") for m in ticket["messages"])

    closed = client.post(
        f"/api/admin/tickets/{answer['ticket']['id']}/close", headers=headers
    ).json()["ticket"]
    assert closed["status"] == "closed"
    assert closed["notes"]
    assert client.get("/api/admin/tickets").status_code == 403


def test_unknown_question_escalates_instead_of_guessing(client):
    sid = new_session(client)
    answer = ask(client, sid, "你们公司老板的私人手机号是多少")
    assert answer["needs_human"] is True
    assert answer["ticket"]["no"].startswith("TK")
    assert "答不上来" in answer["reply"]


def test_greeting_and_thanks_do_not_create_tickets(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    sid = new_session(client)
    assert ask(client, sid, "你好")["intent"] == "greeting"
    assert ask(client, sid, "谢谢")["intent"] == "thanks"
    assert ask(client, sid, "你好")["needs_human"] is False
    assert client.get(
        "/api/admin/tickets", headers={"X-Admin-Token": "test-admin"}
    ).json()["tickets"] == []


def test_support_history_is_stored_on_the_session(client):
    sid = new_session(client)
    ask(client, sid, "运费怎么算？")
    session = client.get(f"/api/sessions/{sid}").json()
    assert [m["role"] for m in session["support"]] == ["user", "assistant"]
    assert "运费" in session["support"][0]["content"]


def test_admin_reply_reaches_the_user_widget(client, monkeypatch):
    """人工客服回复工单后，用户侧能看到这条回复（带稳定 id 供去重）。"""
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    headers = {"X-Admin-Token": "test-admin"}
    sid = new_session(client)
    created = ask(client, sid, "我要转人工")["ticket"]

    assert client.get(f"/api/sessions/{sid}/tickets").json()["tickets"][0]["no"] == created["no"]
    ids_before = [
        message["id"]
        for message in client.get(f"/api/sessions/{sid}/tickets").json()["tickets"][0]["messages"]
    ]
    assert all(ids_before)

    replied = client.post(
        f"/api/admin/tickets/{created['id']}/reply",
        headers=headers,
        json={"message": "收到，我们支持定制刻字，稍后给方案。"},
    ).json()["ticket"]
    assert replied["messages"][-1]["role"] == "staff"
    assert replied["messages"][-1]["content"].startswith("收到")
    assert replied["replied_at"]

    mine = client.get(f"/api/sessions/{sid}/tickets").json()["tickets"][0]
    staff = [m for m in mine["messages"] if m["role"] == "staff"]
    assert staff and staff[-1]["id"] not in ids_before, "人工回复要有新的 id 供前端去重"

    assert client.post(
        f"/api/admin/tickets/{created['id']}/reply", json={"message": "x"}
    ).status_code == 403
    assert client.post(
        "/api/admin/tickets/not-a-ticket/reply",
        headers=headers,
        json={"message": "x"},
    ).status_code == 404


def test_tickets_are_isolated_per_session(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    headers = {"X-Admin-Token": "test-admin"}
    a = new_session(client)
    b = new_session(client)
    ask(client, a, "我要转人工")
    assert client.get(f"/api/sessions/{b}/tickets").json()["tickets"] == []
    assert len(client.get("/api/admin/tickets", headers=headers).json()["tickets"]) == 1


def test_staff_reply_joins_the_session_conversation(client, monkeypatch):
    """人工回复既进工单，也进会话客服记录，后台能看到完整对话。"""
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    headers = {"X-Admin-Token": "test-admin"}
    sid = new_session(client)
    created = ask(client, sid, "我要转人工")["ticket"]
    client.post(
        f"/api/admin/tickets/{created['id']}/reply",
        headers=headers,
        json={"message": "人工客服：已经帮你登记。"},
    )
    conversation = client.get("/api/admin/conversations", headers=headers).json()["conversations"][0]
    assert conversation["session_id"] == sid
    assert conversation["messages"][-1]["role"] == "staff"
    assert conversation["messages"][-1]["content"].startswith("人工客服")
    assert conversation["last_role"] == "staff"


def test_admin_sees_support_conversations_with_history(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin")
    headers = {"X-Admin-Token": "test-admin"}
    sid = new_session(client)
    ask(client, sid, "运费怎么算？")
    ask(client, sid, "可以退货吗")
    quiet = new_session(client)
    latest = new_session(client)
    ask(client, latest, "多久发货")

    assert client.get("/api/admin/conversations").status_code == 403
    conversations = client.get("/api/admin/conversations", headers=headers).json()["conversations"]
    assert [c["session_id"] for c in conversations] == [latest, sid], "最近活跃的会话排最前"
    assert quiet not in [c["session_id"] for c in conversations]
    assert conversations[1]["message_count"] == 4
    assert conversations[1]["last_role"] == "assistant"
    assert conversations[1]["messages"][0]["at"], "客服消息要带时间戳"
    assert any("运费" in m["content"] for m in conversations[1]["messages"])


def test_support_polish_failure_falls_back_to_rule_answer(tmp_path, monkeypatch):
    import shopping.support as support_module

    async def broken(*args, **kwargs):
        raise RuntimeError("LLM provider returned HTTP 401")

    monkeypatch.setattr(support_module, "polish", broken)
    monkeypatch.setenv("OPENAI_NEXT_API_KEY", "test-key-not-used")
    with TestClient(create_app(f"sqlite:///{tmp_path}/polish.db", llm=True)) as c:
        sid = c.post("/api/sessions").json()["id"]
        answer = c.post(
            f"/api/sessions/{sid}/support", json={"message": "运费怎么算？"}
        ).json()
        assert answer["mode"] == "rules-and-live-data"
        assert "HTTP 401" in answer["polish_error"]
        assert "满 ¥99 免运费" in answer["reply"]


def test_support_polish_success_is_labelled(tmp_path, monkeypatch):
    import shopping.support as support_module

    async def ok(reply, message, **kwargs):
        return "（口语化）" + reply

    monkeypatch.setattr(support_module, "polish", ok)
    monkeypatch.setenv("OPENAI_NEXT_API_KEY", "test-key-not-used")
    with TestClient(create_app(f"sqlite:///{tmp_path}/polish-ok.db", llm=True)) as c:
        sid = c.post("/api/sessions").json()["id"]
        answer = c.post(
            f"/api/sessions/{sid}/support", json={"message": "运费怎么算？"}
        ).json()
        assert answer["mode"] == "llm-polished"
        assert answer["reply"].startswith("（口语化）")
