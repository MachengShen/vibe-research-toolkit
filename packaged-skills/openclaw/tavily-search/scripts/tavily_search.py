#!/usr/bin/env python3
"""Tiny Tavily Search CLI helper for OpenClaw skills."""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


API_URL = "https://api.tavily.com/search"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Search the web with Tavily.")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument(
        "--max-results",
        type=int,
        default=5,
        help="Max results to request (default: 5)",
    )
    parser.add_argument(
        "--search-depth",
        choices=("basic", "advanced"),
        default="basic",
        help="Search depth (default: basic)",
    )
    parser.add_argument(
        "--include-raw-content",
        action="store_true",
        help="Include raw page content in results",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=40,
        help="HTTP timeout in seconds (default: 40)",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="Emit compact JSON instead of pretty JSON",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    api_key = os.environ.get("TAVILY_API_KEY", "").strip()

    if not api_key:
        print("Error: TAVILY_API_KEY is not set.", file=sys.stderr)
        return 2

    max_results = max(1, min(args.max_results, 20))
    payload = {
        "query": args.query,
        "search_depth": args.search_depth,
        "include_answer": True,
        "include_images": False,
        "include_raw_content": bool(args.include_raw_content),
        "max_results": max_results,
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        details = err.read().decode("utf-8", errors="replace")
        print(f"HTTP {err.code}: {details}", file=sys.stderr)
        return 1
    except Exception as err:  # pragma: no cover - runtime/network path
        print(f"Request failed: {err}", file=sys.stderr)
        return 1

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        print(body)
        return 0

    # Keep output shape stable and easy for the model to consume.
    result = {
        "query": args.query,
        "answer": parsed.get("answer"),
        "response_time": parsed.get("response_time"),
        "results": [
            {
                "title": item.get("title"),
                "url": item.get("url"),
                "content": item.get("content"),
                "score": item.get("score"),
            }
            for item in parsed.get("results", [])
        ],
    }

    if args.compact:
        print(json.dumps(result, separators=(",", ":"), ensure_ascii=True))
    else:
        print(json.dumps(result, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
