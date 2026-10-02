def test_outbox_records_event_without_mutating_catalog(tmp_path):
    from sqlalchemy import select

    from shopping.store import Store, outbox
    from shopping.worker import pending_events

    s = Store(f"sqlite:///{tmp_path}/outbox.db")
    s.initialize()
    e = {
        "event_id": "queued",
        "product_id": "demo-h1",
        "version": 2,
        "price_cents": 100,
        "stock": 2,
    }
    s.queue_event(e)
    s.queue_event(e)
    assert pending_events(s) == [e]
    assert s.products()[0]["version"] == 1
    with s.engine.connect() as c:
        assert len(c.execute(select(outbox)).all()) == 1


def test_worker_commits_only_applied_record_partition(tmp_path):
    import asyncio
    import json
    from types import SimpleNamespace

    from aiokafka.structs import OffsetAndMetadata, TopicPartition

    from shopping.store import Store
    from shopping.worker import consume_loop

    s = Store(f"sqlite:///{tmp_path}/commit.db")
    s.initialize()
    e = {
        "event_id": "commit",
        "product_id": "demo-h1",
        "version": 2,
        "price_cents": 9000,
        "stock": 2,
    }

    class Consumer:
        def __aiter__(self):
            async def records():
                yield SimpleNamespace(
                    topic="updates",
                    partition=2,
                    offset=7,
                    value=json.dumps(e).encode(),
                    key=b"demo-h1",
                )

            return records()

        async def commit(self, offsets=None):
            self.offsets = offsets

    c = Consumer()
    asyncio.run(consume_loop(s, c, None, "updates"))
    assert c.offsets == {TopicPartition("updates", 2): OffsetAndMetadata(8, "")}


def test_claim_events_allows_only_one_publisher(tmp_path):
    from shopping.store import Store
    from shopping.worker import claim_events

    s = Store(f"sqlite:///{tmp_path}/claim.db")
    s.initialize()
    s.queue_event({"event_id": "claim", "product_id": "demo-h1", "version": 2,
                  "price_cents": 9000, "stock": 2})
    assert [event_id for event_id, _ in claim_events(s)] == ["claim"]
    assert claim_events(s) == []


def test_recover_claims_requeues_crashed_publish(tmp_path):
    from shopping.store import Store
    from shopping.worker import claim_events, recover_claims

    s = Store(f"sqlite:///{tmp_path}/recover.db")
    s.initialize()
    s.queue_event({"event_id": "recover", "product_id": "demo-h1", "version": 2,
                  "price_cents": 9000, "stock": 2})
    claim_events(s)
    recover_claims(s)
    assert [event_id for event_id, _ in claim_events(s)] == ["recover"]
