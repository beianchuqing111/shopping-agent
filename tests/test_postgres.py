import os
import uuid

import pytest


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="real PostgreSQL URL not supplied"
)
def test_real_postgres_persistence_and_event_transaction():
    from shopping.store import Store

    s = Store(os.environ["TEST_DATABASE_URL"])
    s.initialize()
    sid = s.create_session()
    assert s.save_session(
        sid, {"constraints": {"category": "mouse"}, "messages": []}, 0
    )
    assert not s.save_session(sid, {"constraints": {}, "messages": []}, 0)
    reopened = Store(os.environ["TEST_DATABASE_URL"])
    assert reopened.session(sid)["constraints"] == {"category": "mouse"}
    p = next(p for p in s.products() if p["id"] == "demo-m1")
    e = {
        "event_id": str(uuid.uuid4()),
        "product_id": p["id"],
        "version": p["version"] + 1,
        "price_cents": p["price_cents"],
        "stock": p["stock"],
    }
    assert s.apply_event(e) == "applied"
    assert reopened.apply_event(e) == "duplicate"
    assert (
        reopened.apply_event({**e, "event_id": str(uuid.uuid4()), "version": 1})
        == "stale"
    )
