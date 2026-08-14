#!/usr/bin/env python3
"""Bootstrap a fresh Sub-Store instance with this repository's standard structure.

This first version is intentionally conservative: it validates connectivity and
prints the desired structure. API writes are opt-in with --apply so the script
can be tested safely against a new instance before creating anything.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def request(base_url, path, method="GET", body=None, api_key=""):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=data,
        headers=headers,
        method=method,
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually create resources")
    args = parser.parse_args()

    load_env(ROOT / "bootstrap" / ".env")
    base_url = os.getenv("SUBSTORE_BASE_URL", "").rstrip("/")
    api_key = os.getenv("SUBSTORE_API_KEY", "")
    collection_name = os.getenv("AIRPORT_COLLECTION_NAME", "机场合集")
    file_name = os.getenv("MIHOMO_FILE_NAME", "mihomo")

    if not base_url:
        sys.exit("SUBSTORE_BASE_URL is required in bootstrap/.env")

    desired = {
        "collection": collection_name,
        "file": file_name,
        "template": str(ROOT / "templates" / "mihomo-base.yaml"),
        "script": str(ROOT / "mihomo" / "config-builder.js"),
    }

    print("Desired Sub-Store structure:")
    print(json.dumps(desired, ensure_ascii=False, indent=2))

    try:
        subs = request(base_url, "/api/subs", api_key=api_key)
        print("\nSub-Store API reachable: /api/subs OK")
        if isinstance(subs, list):
            print(f"Existing subscriptions: {len(subs)}")
    except urllib.error.HTTPError as exc:
        sys.exit(f"Sub-Store API HTTP error: {exc.code} {exc.reason}")
    except Exception as exc:
        sys.exit(f"Cannot connect to Sub-Store: {exc}")

    if not args.apply:
        print("\nDry run only. Re-run with --apply after reviewing the plan.")
        return

    print("\n--apply requested.")
    print("Resource creation is intentionally not guessed in this scaffold yet.")
    print("Next step: bind collection/file CRUD payloads to the exact API schema of your Sub-Store version.")


if __name__ == "__main__":
    main()
