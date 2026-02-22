#!/usr/bin/env python3
"""Validate experiment metrics.json against the toolkit contract."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any


def load_json(path: pathlib.Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - exact parser errors vary
        raise ValueError(f"failed to parse {path}: {exc}") from exc


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def minimal_validate(doc: Any) -> list[str]:
    errors: list[str] = []

    if not isinstance(doc, dict):
        return ["top-level document must be an object"]

    for key in ("status", "primary", "metrics", "run"):
        if key not in doc:
            errors.append(f"missing required key: {key}")

    status = doc.get("status")
    if status not in {"success", "failed", "canceled"}:
        errors.append("status must be one of: success, failed, canceled")

    primary = doc.get("primary")
    if not isinstance(primary, dict):
        errors.append("primary must be an object")
    else:
        if not isinstance(primary.get("name"), str) or not primary.get("name"):
            errors.append("primary.name must be a non-empty string")
        if not is_number(primary.get("value")):
            errors.append("primary.value must be a number")
        if not isinstance(primary.get("higher_is_better"), bool):
            errors.append("primary.higher_is_better must be a boolean")

    metrics = doc.get("metrics")
    if not isinstance(metrics, dict):
        errors.append("metrics must be an object")

    run = doc.get("run")
    if not isinstance(run, dict):
        errors.append("run must be an object")
    else:
        for key in ("run_id", "started_at", "ended_at"):
            if not isinstance(run.get(key), str) or not run.get(key):
                errors.append(f"run.{key} must be a non-empty string")
        if "seed" in run and not isinstance(run.get("seed"), int):
            errors.append("run.seed must be an integer when present")
        if "params" in run and not isinstance(run.get("params"), dict):
            errors.append("run.params must be an object when present")

    if "artifacts" in doc and not isinstance(doc.get("artifacts"), dict):
        errors.append("artifacts must be an object when present")
    if "error" in doc and not isinstance(doc.get("error"), str):
        errors.append("error must be a string when present")

    return errors


def jsonschema_validate(doc: Any, schema: Any) -> tuple[list[str], str]:
    try:
        import jsonschema  # type: ignore
    except Exception:
        return [], "jsonschema not available; used minimal validator"

    validator_cls = getattr(jsonschema, "Draft202012Validator", None)
    if validator_cls is None:
        validator_cls = jsonschema.Draft7Validator
    validator = validator_cls(schema)

    errors = sorted(validator.iter_errors(doc), key=lambda err: list(err.absolute_path))
    messages = []
    for err in errors:
        path = ".".join(str(part) for part in err.absolute_path) or "$"
        messages.append(f"{path}: {err.message}")
    return messages, "jsonschema validator"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metrics_path", type=pathlib.Path, help="Path to metrics.json")
    parser.add_argument(
        "--schema",
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parent / "metrics_schema.json",
        help="Path to metrics schema (default: tools/exp/metrics_schema.json)",
    )
    args = parser.parse_args()

    if not args.metrics_path.is_file():
        print(f"[validate_metrics][fail] missing metrics file: {args.metrics_path}", file=sys.stderr)
        return 1
    if not args.schema.is_file():
        print(f"[validate_metrics][fail] missing schema file: {args.schema}", file=sys.stderr)
        return 1

    try:
        metrics_doc = load_json(args.metrics_path)
        schema_doc = load_json(args.schema)
    except ValueError as exc:
        print(f"[validate_metrics][fail] {exc}", file=sys.stderr)
        return 1

    strict_errors, mode = jsonschema_validate(metrics_doc, schema_doc)
    if strict_errors:
        print(f"[validate_metrics][fail] validation failed ({mode})", file=sys.stderr)
        for msg in strict_errors:
            print(f"  - {msg}", file=sys.stderr)
        return 1

    # Keep minimal checks active even when jsonschema exists so missing dependency
    # behavior and explicit type requirements stay aligned.
    minimal_errors = minimal_validate(metrics_doc)
    if minimal_errors:
        print("[validate_metrics][fail] validation failed (minimal validator)", file=sys.stderr)
        for msg in minimal_errors:
            print(f"  - {msg}", file=sys.stderr)
        return 1

    print(f"[validate_metrics] ok: {args.metrics_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
