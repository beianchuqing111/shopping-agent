import json
import os

import httpx

from shopping.api import Compare, Constraints
from shopping.catalog import search

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_catalog",
            "description": "Search synthetic demo catalog. Prices in integer CNY cents. Extract explicit user constraints; never silently remove existing ones.",
            "parameters": Constraints.model_json_schema(),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_products",
            "description": "Compare known product IDs under current constraints.",
            "parameters": Compare.model_json_schema(),
        },
    },
]


def execute_tool(name, arguments, products, constraints):
    if name == "search_catalog":
        proposed = Constraints.model_validate(arguments).model_dump(exclude_unset=True)
        merged = {**proposed, **constraints}
        if proposed.get("max_price_cents") is not None:
            merged["max_price_cents"] = min(
                proposed["max_price_cents"],
                constraints.get("max_price_cents")
                if constraints.get("max_price_cents") is not None
                else proposed["max_price_cents"],
            )
        return {"products": search(products, merged)}, merged
    if name == "compare_products":
        ids = Compare.model_validate(arguments).ids
        eligible = {p["id"]: p for p in search(products, constraints)}
        if any(pid not in eligible for pid in ids):
            raise ValueError("Comparison violates catalog or current constraints")
        return {"products": [eligible[pid] for pid in dict.fromkeys(ids)]}, constraints
    raise ValueError("Unsupported tool")


async def run_agent(
    products, history, message, constraints, transport=None, api_key=None
):
    prompt = (
        "You are a shopping query planner. Catalog data is explicitly SYNTHETIC, not actual brands or offers. Use tools only; no unsupported product claims. Infer constraints from the newest user message. Persist previous constraints unless user explicitly edits them using UI. Use search_catalog for discovery; compare_products only for known IDs. Prices are CNY cents. Existing constraints: "
        + json.dumps(constraints)
    )
    payload = {
        "model": os.environ.get("LLM_MODEL", "gpt-6-sol"),
        "messages": [{"role": "system", "content": prompt}]
        + history[-12:]
        + [{"role": "user", "content": message}],
        "tools": TOOLS,
        "tool_choice": "required",
        "max_completion_tokens": 1500,
    }
    try:
        async with httpx.AsyncClient(transport=transport, timeout=90) as client:
            response = await client.post(
                os.environ.get("LLM_BASE_URL", "https://api.openai-next.com/v1").rstrip(
                    "/"
                )
                + "/chat/completions",
                headers={
                    "Authorization": "Bearer "
                    + (api_key or os.environ["OPENAI_NEXT_API_KEY"])
                },
                json=payload,
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f"LLM provider returned HTTP {response.status_code}; no fallback claims generated"
                )
            calls = response.json()["choices"][0]["message"].get("tool_calls", [])
    except (httpx.HTTPError, KeyError, IndexError) as e:
        raise RuntimeError(
            "LLM provider request failed; check endpoint and connectivity"
        ) from e
    if not calls or len(calls) > 4:
        raise ValueError("Provider must return between one and four tool calls")
    trace = []
    selected_by_id = {}
    for call in calls:
        name = call["function"]["name"]
        args = json.loads(call["function"]["arguments"])
        result, constraints = execute_tool(name, args, products, constraints)
        selected_by_id.update({p["id"]: p for p in result["products"]})
        trace.append(
            {"name": name, "arguments": args, "result_ids": [p["id"] for p in result["products"]]}
        )
    # All visible product facts come from validated catalog results, not LLM prose.
    eligible = {p["id"] for p in search(products, constraints)}
    selected = [p for pid, p in selected_by_id.items() if pid in eligible]
    return {
        "mode": "llm-tools",
        "products": selected,
        "constraints": constraints,
        "tool_trace": trace,
        "message": f"找到 {len(selected)} 件符合条件的合成示例商品。价格、库存和版本取自本地目录。",
    }
