"""Append-only, hash-chained audit ledger (JSON lines).

Each entry: {seq, ts, actor, type, payload, payload_sha256, prev_hash, hash}
hash = sha256(prev_hash + canonical_json(entry without hash)). Any edit to any
past entry breaks every later hash, which verify() reports."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from satsa.store import DATA

LEDGER_PATH = Path(os.environ.get("SATSA_LEDGER", DATA / "ledger.jsonl"))
GENESIS = "0" * 64
_lock = threading.Lock()


def _canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def read(path: Path = LEDGER_PATH) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append(type_: str, payload: dict, actor: str = "system", path: Path = LEDGER_PATH) -> dict:
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        entries = read(path)
        prev = entries[-1]["hash"] if entries else GENESIS
        entry = {"seq": len(entries) + 1, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "actor": actor, "type": type_, "payload": payload, "payload_sha256": _sha(_canon(payload)),
                 "prev_hash": prev}
        entry["hash"] = _sha(prev + _canon(entry))
        with path.open("a", encoding="utf-8") as f:
            f.write(_canon(entry) + "\n")
        return entry


def verify(path: Path = LEDGER_PATH) -> dict:
    entries = read(path)
    prev = GENESIS
    for e in entries:
        body = {k: v for k, v in e.items() if k != "hash"}
        problems = []
        if e["prev_hash"] != prev:
            problems.append("prev_hash does not match the previous entry")
        if _sha(_canon(e["payload"])) != e["payload_sha256"]:
            problems.append("payload was modified after it was recorded")
        if _sha(prev + _canon(body)) != e["hash"]:
            problems.append("entry hash mismatch")
        if problems:
            return {"ok": False, "entries": len(entries), "broken_at": e["seq"], "problems": problems}
        prev = e["hash"]
    return {"ok": True, "entries": len(entries), "head": prev}


def tamper_demo() -> dict:
    """Copy the ledger, alter one historical payload in the copy, and verify the copy.
    The real ledger is never modified."""
    demo = LEDGER_PATH.with_name("ledger_tamper_demo.jsonl")
    if not LEDGER_PATH.exists():
        return {"ok": True, "entries": 0}
    shutil.copy(LEDGER_PATH, demo)
    entries = read(demo)
    if len(entries) < 2:
        return verify(demo)
    target = entries[len(entries) // 2]
    target["payload"] = dict(target["payload"], tampered="an insider edited this record")
    demo.write_text("\n".join(_canon(e) for e in entries) + "\n", encoding="utf-8")
    res = verify(demo)
    res["tampered_seq"] = target["seq"]
    return res
