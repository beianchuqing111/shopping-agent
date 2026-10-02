import asyncio
import json
import logging
import os

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.structs import OffsetAndMetadata, TopicPartition
from sqlalchemy import select, update

from shopping.api import ProductEvent
from shopping.store import Store, outbox

log = logging.getLogger(__name__)


def pending_events(store):
    with store.engine.connect() as c:
        return list(
            c.execute(
                select(outbox.c.payload).where(outbox.c.status == "pending").limit(100)
            ).scalars()
        )


def claim_events(store):
    claimed = []
    with store.engine.begin() as c:
        rows = c.execute(
            select(outbox.c.id, outbox.c.payload)
            .where(outbox.c.status == "pending")
            .limit(100)
        ).all()
        for event_id, payload in rows:
            updated = c.execute(
                update(outbox)
                .where(outbox.c.id == event_id, outbox.c.status == "pending")
                .values(status="publishing")
            ).rowcount
            if updated == 1:
                claimed.append((event_id, payload))
    return claimed


def recover_claims(store):
    """A restarted worker can safely retry claims left by a crashed publisher."""
    with store.engine.begin() as c:
        c.execute(
            update(outbox)
            .where(outbox.c.status == "publishing")
            .values(status="pending")
        )


async def publish_loop(store, producer, topic):
    await asyncio.to_thread(recover_claims, store)
    while True:
        for event_id, event in await asyncio.to_thread(claim_events, store):
            try:
                await producer.send_and_wait(
                    topic,
                    key=event["product_id"].encode(),
                    value=json.dumps(event).encode(),
                )
            except Exception:
                with store.engine.begin() as c:
                    c.execute(
                        update(outbox)
                        .where(outbox.c.id == event_id, outbox.c.status == "publishing")
                        .values(status="pending")
                    )
                raise
            with store.engine.begin() as c:
                c.execute(
                    update(outbox)
                    .where(outbox.c.id == event_id, outbox.c.status == "publishing")
                    .values(status="sent")
                )
        await asyncio.sleep(1)


async def consume_loop(store, consumer, producer, topic):
    async for record in consumer:
        try:
            event = ProductEvent.model_validate_json(record.value).model_dump()
            status = await asyncio.to_thread(store.apply_event, event)
            log.info("event=%s status=%s", event["event_id"], status)
        except ValueError as e:
            await producer.send_and_wait(
                topic + ".dead-letter",
                key=record.key,
                value=json.dumps(
                    {"payload": record.value.decode(errors="replace"), "error": str(e)}
                ).encode(),
            )
        # Offset only advances after database transaction or acknowledged DLQ write.
        await consumer.commit(
            {
                TopicPartition(record.topic, record.partition): OffsetAndMetadata(
                    record.offset + 1, ""
                )
            }
        )


async def main():
    store = Store(os.environ["DATABASE_URL"])
    store.initialize()
    broker = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:9092")
    topic = os.environ.get("KAFKA_TOPIC", "product-updates")
    producer = AIOKafkaProducer(bootstrap_servers=broker, enable_idempotence=True)
    consumer = AIOKafkaConsumer(
        topic,
        bootstrap_servers=broker,
        group_id="shopping-catalog-v1",
        enable_auto_commit=False,
        auto_offset_reset="earliest",
    )
    try:
        await producer.start()
        await consumer.start()
        await asyncio.gather(
            publish_loop(store, producer, topic),
            consume_loop(store, consumer, producer, topic),
        )
    finally:
        await consumer.stop()
        await producer.stop()
        store.engine.dispose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
