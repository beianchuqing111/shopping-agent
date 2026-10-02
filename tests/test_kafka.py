import asyncio
import json
import os
import uuid

import pytest


@pytest.mark.skipif(
    not os.environ.get("TEST_KAFKA_BOOTSTRAP_SERVERS")
    or not os.environ.get("TEST_DATABASE_URL"),
    reason="real Kafka and PG env required",
)
def test_real_kafka_outbox_pg_duplicate_stale_and_dlq():
    from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
    from sqlalchemy import select

    from shopping.store import Store, outbox, processed
    from shopping.worker import consume_loop, publish_loop

    async def run():
        store = Store(os.environ["TEST_DATABASE_URL"])
        store.initialize()
        topic = "test-shopping-" + uuid.uuid4().hex
        broker = os.environ["TEST_KAFKA_BOOTSTRAP_SERVERS"]
        producer = AIOKafkaProducer(bootstrap_servers=broker, enable_idempotence=True)
        consumer = AIOKafkaConsumer(
            topic,
            bootstrap_servers=broker,
            group_id=topic,
            auto_offset_reset="earliest",
            enable_auto_commit=False,
        )
        dlq = AIOKafkaConsumer(
            topic + ".dead-letter",
            bootstrap_servers=broker,
            group_id=topic + "-dlq",
            auto_offset_reset="earliest",
        )
        tasks = []
        try:
            await producer.start()
            await consumer.start()
            await dlq.start()
            tasks = [
                asyncio.create_task(publish_loop(store, producer, topic)),
                asyncio.create_task(consume_loop(store, consumer, producer, topic)),
            ]
            p = next(p for p in store.products() if p["id"] == "demo-k1")
            e = {
                "event_id": uuid.uuid4().hex,
                "product_id": p["id"],
                "version": p["version"] + 1,
                "price_cents": p["price_cents"],
                "stock": p["stock"],
            }
            store.queue_event(e)

            async def await_processed(event_id):
                for _ in range(200):
                    with store.engine.connect() as c:
                        row = c.execute(
                            select(processed.c.status).where(processed.c.id == event_id)
                        ).scalar()
                    if row:
                        return row
                    await asyncio.sleep(0.1)
                raise AssertionError("event not consumed")

            assert await await_processed(e["event_id"]) == "applied"
            await producer.send_and_wait(
                topic, key=p["id"].encode(), value=json.dumps(e).encode()
            )
            stale = {**e, "event_id": uuid.uuid4().hex, "version": 1}
            await producer.send_and_wait(
                topic, key=p["id"].encode(), value=json.dumps(stale).encode()
            )
            assert await await_processed(stale["event_id"]) == "stale"
            await producer.send_and_wait(topic, value=b'{"invalid":true}')
            record = await asyncio.wait_for(dlq.getone(), 20)
            assert "invalid" in json.loads(record.value)["payload"]
            assert (
                next(x for x in store.products() if x["id"] == p["id"])["version"]
                == e["version"]
            )
            with store.engine.connect() as c:
                assert (
                    c.execute(
                        select(outbox.c.status).where(outbox.c.id == e["event_id"])
                    ).scalar()
                    == "sent"
                )
                assert (
                    len(
                        c.execute(
                            select(processed).where(processed.c.id == e["event_id"])
                        ).all()
                    )
                    == 1
                )
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await dlq.stop()
            await consumer.stop()
            await producer.stop()
            store.engine.dispose()

    asyncio.run(run())
