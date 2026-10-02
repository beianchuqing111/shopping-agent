"""Load only the approved key into child process environment, never repository files."""

import os
import subprocess
from pathlib import Path

from dotenv import dotenv_values

home = Path(os.environ.get("HERMES_HOME", str(Path.home() / "AppData/Local/hermes")))
key = dotenv_values(home / ".env").get("OPENAI_NEXT_API_KEY")
env = os.environ.copy()
if key:
    env["OPENAI_NEXT_API_KEY"] = key
env.setdefault(
    "DATABASE_URL", "postgresql+psycopg://shop@127.0.0.1:55432/shopping_agent"
)
raise SystemExit(
    subprocess.call(
        [
            os.sys.executable,
            "-m",
            "uvicorn",
            "shopping.api:app",
            "--host",
            "127.0.0.1",
            "--port",
            env.get("PORT", "58123"),
        ],
        env=env,
    )
)
