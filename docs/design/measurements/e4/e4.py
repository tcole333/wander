"""E4: edge-cache retention for R2 objects on wander-data.traviscole.xyz, measured from this Mac.

Streaming design 8.2, E4. Setup uploads 200 gzip objects of about 40 KB under `_e4/` with
production headers and warms each once. Every object belongs to one of four cohorts, and each cohort
is read only at its own checkpoint (1 h, 24 h, 72 h, 7 d after the warm), so an early probe never
re-warms objects a later checkpoint reads. Each probe is a GET on a fresh connection, then a second
GET that should hit.

    python3 e4.py setup           generate, upload, warm, write state.json
    python3 e4.py measure 24h     read that checkpoint's cohort, write results/24h.json
    python3 e4.py report          summarize results/*.json into results/summary.md

Needs curl with HTTP/2 and, for setup, npx (wrangler). Standard library only.
"""

import concurrent.futures
import gzip
import hashlib
import json
import random
import statistics
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "state.json"
RESULTS = HERE / "results"
DATA_HOST = "https://wander-data.traviscole.xyz"
BUCKET = "wander-data"
WRANGLER = ["npx", "-y", "wrangler@4.139.0"]
CACHE_CONTROL = "public, max-age=31536000, immutable"
OBJECT_COUNT = 200
PAYLOAD_BYTES = 40 * 1024
CHECKPOINTS = ["1h", "24h", "72h", "7d"]
# A beat's critical set fits the median flight plus the maximum hold only while a miss costs less
# than about this much (streaming design 8.2, E4 break point).
BREAK_POINT_MS = 500


def now() -> datetime:
    return datetime.now(UTC)


def make_objects(workdir: Path) -> list[dict]:
    objects = []
    for index in range(OBJECT_COUNT):
        payload = random.Random(f"wander-e4-{index}").randbytes(PAYLOAD_BYTES)
        body = gzip.compress(payload, compresslevel=9, mtime=0)
        digest = hashlib.sha256(body).hexdigest()
        path = workdir / f"{digest[:16]}.bin"
        path.write_bytes(body)
        objects.append(
            {
                "key": f"_e4/{digest[:16]}.bin",
                "sha256": digest,
                "bytes": len(body),
                "cohort": CHECKPOINTS[index % len(CHECKPOINTS)],
                "file": str(path),
            }
        )
    return objects


def upload(obj: dict) -> None:
    subprocess.run(
        [
            *WRANGLER,
            "r2",
            "object",
            "put",
            f"{BUCKET}/{obj['key']}",
            "--file",
            obj["file"],
            "--content-type",
            "application/octet-stream",
            "--cache-control",
            CACHE_CONTROL,
            "--remote",
        ],
        check=True,
        capture_output=True,
    )


def get(obj: dict) -> dict:
    """One GET on a fresh connection, with curl's timings and the headers E4 checks."""
    with tempfile.TemporaryDirectory() as scratch:
        body_path = Path(scratch) / "body"
        headers_path = Path(scratch) / "headers"
        result = subprocess.run(
            [
                "curl",
                "--silent",
                "--http2",
                "--output",
                str(body_path),
                "--dump-header",
                str(headers_path),
                "--write-out",
                "%{json}",
                "--header",
                "Origin: https://wander.traviscole.xyz",
                f"{DATA_HOST}/{obj['key']}",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        timing = json.loads(result.stdout)
        headers = {}
        for line in headers_path.read_text().splitlines():
            name, sep, value = line.partition(":")
            if sep:
                headers[name.strip().lower()] = value.strip()
        body = body_path.read_bytes() if body_path.exists() else b""
    return {
        "status": timing["response_code"],
        "httpVersion": timing["http_version"],
        "cacheStatus": headers.get("cf-cache-status", ""),
        "age": int(headers["age"]) if headers.get("age", "").isdigit() else None,
        "colo": headers.get("cf-ray", "").rpartition("-")[2],
        "ttfbMs": round(timing["time_starttransfer"] * 1000, 1),
        "waitMs": round((timing["time_starttransfer"] - timing["time_pretransfer"]) * 1000, 1),
        "sha256Ok": hashlib.sha256(body).hexdigest() == obj["sha256"],
        "contentType": headers.get("content-type", ""),
        "cacheControl": headers.get("cache-control", ""),
        "cors": headers.get("access-control-allow-origin", ""),
        "timingAllowOrigin": headers.get("timing-allow-origin", ""),
    }


def probe(obj: dict) -> dict:
    first = get(obj)
    second = get(obj)
    return {"key": obj["key"], "cohort": obj["cohort"], "first": first, "second": second}


def setup() -> None:
    if STATE.exists():
        sys.exit(f"{STATE} exists; setup already ran.")
    with tempfile.TemporaryDirectory() as scratch:
        objects = make_objects(Path(scratch))
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(upload, objects))
        uploaded_at = now()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            warm = list(pool.map(probe, objects))
    warmed_at = now()
    for obj in objects:
        del obj["file"]
    state = {
        "uploadedAt": uploaded_at.isoformat(),
        "warmedAt": warmed_at.isoformat(),
        "objects": objects,
    }
    STATE.write_text(json.dumps(state, indent=1) + "\n")
    RESULTS.mkdir(exist_ok=True)
    write_result("warm", warmed_at, 0.0, warm)
    print(summary_line("warm", warm))


def write_result(checkpoint: str, measured_at: datetime, elapsed_hours: float, rows: list) -> None:
    (RESULTS / f"{checkpoint}.json").write_text(
        json.dumps(
            {
                "checkpoint": checkpoint,
                "measuredAt": measured_at.isoformat(),
                "elapsedHours": round(elapsed_hours, 2),
                "rows": rows,
            },
            indent=1,
        )
        + "\n"
    )


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(fraction * (len(ordered) - 1)))]


def stats(rows: list) -> dict:
    firsts = [row["first"] for row in rows]
    hits = [r["waitMs"] for r in firsts if r["cacheStatus"] == "HIT"]
    others = [r["waitMs"] for r in firsts if r["cacheStatus"] != "HIT"]
    waits = [r["waitMs"] for r in firsts]
    return {
        "objects": len(rows),
        "firstHit": len(hits),
        "firstOther": sorted({r["cacheStatus"] for r in firsts if r["cacheStatus"] != "HIT"}),
        "secondHit": sum(row["second"]["cacheStatus"] == "HIT" for row in rows),
        "waitP50": statistics.median(waits) if waits else None,
        "waitP90": percentile(waits, 0.9),
        "hitWaitP50": statistics.median(hits) if hits else None,
        "missWaitP50": statistics.median(others) if others else None,
        "missWaitP90": percentile(others, 0.9),
        "badBodies": sum(not r["sha256Ok"] for r in firsts),
        "badHeaders": sum(
            r["contentType"] != "application/octet-stream"
            or r["cacheControl"] != CACHE_CONTROL
            or r["cors"] != "*"
            or r["timingAllowOrigin"] != "*"
            for r in firsts
        ),
        "colos": sorted({r["colo"] for r in firsts}),
    }


def summary_line(checkpoint: str, rows: list) -> str:
    s = stats(rows)
    return (
        f"{checkpoint}: {s['firstHit']}/{s['objects']} hit on first read, "
        f"{s['secondHit']}/{s['objects']} on the second; wait p50 {s['waitP50']} ms, "
        f"p90 {s['waitP90']} ms; bad bodies {s['badBodies']}, bad headers {s['badHeaders']}"
    )


def measure(checkpoint: str) -> None:
    if checkpoint not in CHECKPOINTS:
        sys.exit(f"checkpoint must be one of {CHECKPOINTS}")
    if (RESULTS / f"{checkpoint}.json").exists():
        sys.exit(f"{checkpoint} was already measured; its cohort is no longer cold.")
    state = json.loads(STATE.read_text())
    cohort = [obj for obj in state["objects"] if obj["cohort"] == checkpoint]
    measured_at = now()
    elapsed = (measured_at - datetime.fromisoformat(state["warmedAt"])).total_seconds() / 3600
    # One at a time, so probes don't queue behind each other and skew the timings.
    rows = [probe(obj) for obj in cohort]
    write_result(checkpoint, measured_at, elapsed, rows)
    print(f"{summary_line(checkpoint, rows)}; {elapsed:.1f} h after the warm")


def report() -> None:
    lines = [
        "# E4 results (this Mac only)",
        "",
        "Wait is curl's time from request sent to first byte, excluding DNS, TCP and TLS. "
        f"The break point is {BREAK_POINT_MS} ms per miss (streaming design 8.2, E4).",
        "",
        "| Checkpoint | Hours after warm | First-read hits | Second-read hits | Wait p50 / p90 ms "
        "| Miss wait p50 / p90 ms | Bad bodies / headers | Data centers |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for checkpoint in ["warm", *CHECKPOINTS]:
        path = RESULTS / f"{checkpoint}.json"
        if not path.exists():
            continue
        result = json.loads(path.read_text())
        s = stats(result["rows"])
        lines.append(
            f"| {checkpoint} | {result['elapsedHours']} | {s['firstHit']}/{s['objects']} "
            f"| {s['secondHit']}/{s['objects']} | {s['waitP50']} / {s['waitP90']} "
            f"| {s['missWaitP50']} / {s['missWaitP90']} | {s['badBodies']} / {s['badHeaders']} "
            f"| {', '.join(s['colos'])} |"
        )
    (RESULTS / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "setup":
        setup()
    elif command == "measure" and len(sys.argv) == 3:
        measure(sys.argv[2])
    elif command == "report":
        report()
    else:
        sys.exit(__doc__)
