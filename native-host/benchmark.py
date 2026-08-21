#!/usr/bin/env python3
"""Measure FluxCatch direct-download throughput against a chosen URL."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import tempfile
import threading
import time

HOST_PATH = pathlib.Path(__file__).with_name("host.py")
SPEC = importlib.util.spec_from_file_location("fluxcatch_benchmark_host", HOST_PATH)
host = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
import sys
sys.modules[SPEC.name] = host
SPEC.loader.exec_module(host)


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark HTTP Range concurrency. The URL is downloaded once per worker value.")
    parser.add_argument("url", help="HTTP(S) media URL")
    parser.add_argument("--workers", default="1,2,4,8", help="comma-separated concurrency values (default: 1,2,4,8)")
    parser.add_argument("--header", action="append", default=[], metavar="NAME:VALUE", help="request header; repeat as needed")
    args = parser.parse_args()
    url = host.valid_url(args.url)
    headers = {}
    for item in args.header:
        if ":" not in item:
            parser.error(f"invalid header: {item}")
        key, value = item.split(":", 1)
        headers[key.strip()] = value.strip()
    headers = host.clean_headers(headers)
    workers = sorted(set(max(1, min(24, int(value))) for value in args.workers.split(",") if value.strip()))
    probe = host.probe_direct(url, headers)
    results = []
    with tempfile.TemporaryDirectory(prefix="fluxcatch-benchmark-") as directory:
        for count in workers:
            target = pathlib.Path(directory) / f"download-{count}.bin"
            progress = host.Progress(lambda _event: None, f"bench-{count}", target.name)
            started = time.perf_counter()
            host.multipart_download(url, target, headers, count, threading.Event(), progress)
            elapsed = time.perf_counter() - started
            size = target.stat().st_size
            results.append({
                "workers": count,
                "bytes": size,
                "seconds": round(elapsed, 4),
                "mib_per_second": round(size / max(elapsed, 1e-9) / 1024 / 1024, 2),
            })
    print(json.dumps({"url": url, "range_supported": probe.range_supported, "content_length": probe.length, "results": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
