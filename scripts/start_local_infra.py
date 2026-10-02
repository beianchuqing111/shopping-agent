import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"
parser = argparse.ArgumentParser()
parser.add_argument("service", choices=["postgres", "kafka"])
args = parser.parse_args()
if args.service == "postgres":
    subprocess.run(
        [
            str(RUNTIME / "pgsql/bin/pg_ctl.exe"),
            "-D",
            str(RUNTIME / "pgdata"),
            "-l",
            str(RUNTIME / "postgres.log"),
            "-o",
            "-h 127.0.0.1 -p 55432",
            "start",
        ],
        check=True,
    )
else:
    java = next((RUNTIME / "java").glob("*/bin/java.exe"))
    kafka = RUNTIME / "kafka_2.13-3.9.1"
    subprocess.run(
        [
            str(java),
            "-Xms128m",
            "-Xmx512m",
            "-Dlog4j.configuration=" + (kafka / "config/log4j.properties").as_uri(),
            "-cp",
            str(kafka / "libs/*"),
            "kafka.Kafka",
            str(RUNTIME / "kraft.properties"),
        ],
        check=True,
    )
