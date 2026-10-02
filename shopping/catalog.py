import re
from decimal import Decimal


def explicit_patch(message):
    patch = {}
    for word, category in (
        ("耳机", "headphones"),
        ("键盘", "keyboard"),
        ("鼠标", "mouse"),
        ("headphones", "headphones"),
        ("keyboard", "keyboard"),
        ("mouse", "mouse"),
    ):
        if word in message.lower():
            patch["category"] = category
    match = re.search(r"(\d+(?:\.\d{1,2})?)\s*元", message)
    if match and any(word in message for word in ("以内", "以下", "预算", "不超过")):
        patch["max_price_cents"] = int(Decimal(match.group(1)) * 100)
    return patch


def search(products, constraints):
    result = []
    for p in products:
        if p["stock"] <= 0:
            continue
        if constraints.get("category") and p["category"] != constraints["category"]:
            continue
        if (
            constraints.get("brand")
            and p["brand"].lower() != constraints["brand"].lower()
        ):
            continue
        if (
            constraints.get("max_price_cents") is not None
            and p["price_cents"] > constraints["max_price_cents"]
        ):
            continue
        result.append(
            {
                **p,
                "evidence": {
                    "source": "synthetic-fixture",
                    "product_id": p["id"],
                    "version": p["version"],
                },
            }
        )
    return sorted(result, key=lambda p: (p["price_cents"], p["id"]))
