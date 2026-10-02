import asyncio
import os
from pathlib import Path

import httpx
from dotenv import dotenv_values

from shopping.agent import run_agent
from shopping.store import FIXTURES


async def main():
    key = dotenv_values(
        Path(os.environ.get("HERMES_HOME", str(Path.home() / "AppData/Local/hermes")))
        / ".env"
    ).get("OPENAI_NEXT_API_KEY")
    if not key:
        raise SystemExit("BLOCKED: approved key absent")
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(
            "https://api.openai-next.com/v1/models",
            headers={"Authorization": "Bearer " + key},
        )
        print("authenticated models HTTP", r.status_code)
        r.raise_for_status()
        print(
            "exact model present", any(m["id"] == "gpt-6-sol" for m in r.json()["data"])
        )
    result = await run_agent(FIXTURES, [], "100元以内耳机", {}, api_key=key)
    print(
        {
            "mode": result["mode"],
            "constraints": result["constraints"],
            "products": [p["id"] for p in result["products"]],
            "tool_trace": result["tool_trace"],
        }
    )


asyncio.run(main())
