"""Ingestion: CSV / JSON / Parquet / SQLite submissions -> canonical tables,
with column aliasing and a per-file validation report. Malformed files are
rejected, never silently repaired."""

from __future__ import annotations

import hashlib
import io
import json
import sqlite3
from pathlib import Path

import pandas as pd

# canonical table -> required columns
SCHEMA = {
    "entities": ["entity_id", "entity_name", "sector"],
    "assets": ["asset_id", "entity_id", "asset_class", "criticality"],
    "alerts": ["alert_id", "entity_id", "asset_id", "ts", "category", "severity", "detector_id"],
    "cases": ["case_id", "entity_id", "alert_id", "severity", "opened_ts", "ack_ts", "closed_ts", "escalated", "notes"],
    "case_events": ["case_id", "ts", "activity"],
    "escalations": ["case_id", "entity_id", "ts", "to_level"],
    "submissions": ["submission_id", "entity_id", "period", "due_ts", "received_ts"],
    "redteam": ["entity_id", "category", "target_asset", "start_ts"],
}
TIME_COLS = {"ts", "opened_ts", "ack_ts", "closed_ts", "alert_ts", "due_ts", "received_ts", "start_ts", "end_ts",
             "acknowledged_ts"}
ALIASES = {  # common vendor / export spellings -> canonical
    "alertid": "alert_id", "alert_uid": "alert_id", "incidentid": "case_id", "incident_id": "case_id",
    "ticket_id": "case_id", "orgid": "entity_id", "org_id": "entity_id", "cse_id": "entity_id",
    "timestamp": "ts", "event_time": "ts", "created_at": "opened_ts", "created": "opened_ts",
    "acknowledged_at": "ack_ts", "resolved_at": "closed_ts", "closed_at": "closed_ts",
    "priority": "severity", "rule_id": "detector_id", "detectorid": "detector_id", "hostname": "asset_id",
    "device_id": "asset_id", "comment": "notes", "analyst_notes": "notes", "is_escalated": "escalated",
}
FILE_TABLE = {  # filename stem -> table
    "entities": "entities", "entity": "entities", "assets": "assets", "asset_inventory": "assets",
    "alerts": "alerts", "alert_metadata": "alerts", "cases": "cases", "case_management": "cases",
    "case_events": "case_events", "workflow": "case_events", "investigation_workflow": "case_events",
    "escalations": "escalations", "escalation_records": "escalations", "submissions": "submissions",
    "redteam": "redteam", "red_team": "redteam",
}


def _norm_cols(df: pd.DataFrame) -> pd.DataFrame:
    cols = {}
    for c in df.columns:
        k = str(c).strip().lower().replace(" ", "_").replace("-", "_")
        cols[c] = ALIASES.get(k, k)
    return df.rename(columns=cols)


def read_any(name: str, content: bytes) -> dict[str, pd.DataFrame]:
    """Parse one uploaded file into {table: df}."""
    stem, ext = Path(name).stem.lower(), Path(name).suffix.lower()
    if ext == ".csv":
        return {FILE_TABLE.get(stem, stem): pd.read_csv(io.BytesIO(content))}
    if ext in (".json", ".ndjson", ".jsonl"):
        txt = content.decode("utf-8")
        if ext != ".json" or txt.lstrip().startswith("{") and "\n{" in txt:
            return {FILE_TABLE.get(stem, stem): pd.read_json(io.StringIO(txt), lines=True)}
        obj = json.loads(txt)
        if isinstance(obj, dict):  # {"alerts": [...], "cases": [...]}
            return {FILE_TABLE.get(k, k): pd.DataFrame(v) for k, v in obj.items()}
        return {FILE_TABLE.get(stem, stem): pd.DataFrame(obj)}
    if ext == ".parquet":
        return {FILE_TABLE.get(stem, stem): pd.read_parquet(io.BytesIO(content))}
    if ext in (".sqlite", ".db", ".sqlite3"):
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            f.write(content)
            path = f.name
        con = sqlite3.connect(path)
        out = {}
        for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            out[FILE_TABLE.get(t.lower(), t.lower())] = pd.read_sql(f'SELECT * FROM "{t}"', con)
        con.close()
        return out
    raise ValueError(f"Unsupported file type: {ext}")


def validate_table(table: str, df: pd.DataFrame) -> tuple[pd.DataFrame | None, dict]:
    rep = {"table": table, "rows": int(len(df)), "errors": [], "warnings": []}
    if table not in SCHEMA:
        rep["errors"].append(f"Unknown table '{table}'. Expected one of {sorted(SCHEMA)}")
        return None, rep
    df = _norm_cols(df)
    missing = [c for c in SCHEMA[table] if c not in df.columns]
    if missing:
        rep["errors"].append(f"Missing required columns: {missing}")
        return None, rep
    if len(df) == 0:
        rep["errors"].append("File has no data rows")
        return None, rep
    for c in df.columns:
        if c in TIME_COLS:
            parsed = pd.to_datetime(df[c], errors="coerce")
            bad = parsed.isna() & df[c].notna() & (df[c].astype(str).str.len() > 0)
            if bad.any():
                rows = (bad[bad].index[:5] + 2).tolist()
                rep["errors"].append(f"Column '{c}': {int(bad.sum())} unparseable timestamps (first rows: {rows})")
            df[c] = parsed
    key = SCHEMA[table][0]
    if key.endswith("_id") and table not in ("case_events", "escalations", "redteam") and df[key].duplicated().any():
        rep["errors"].append(f"Duplicate {key} values: {int(df[key].duplicated().sum())}")
    nulls = {c: int(df[c].isna().sum()) for c in SCHEMA[table] if c not in ("closed_ts",) and df[c].isna().any()}
    if nulls:
        rep["warnings"].append(f"Null values in required columns: {nulls}")
    return (None if rep["errors"] else df), rep


def ingest_files(files: list[tuple[str, bytes]]) -> tuple[dict[str, pd.DataFrame], dict]:
    """Validate a submission bundle. Returns (tables, report). Tables is empty if any file failed."""
    tables: dict[str, list[pd.DataFrame]] = {}
    reports, hashes = [], {}
    for name, content in files:
        hashes[name] = hashlib.sha256(content).hexdigest()
        try:
            parsed = read_any(name, content)
        except Exception as e:  # noqa: BLE001 - surface parse errors to the user
            reports.append({"file": name, "table": None, "rows": 0, "errors": [f"Parse error: {e}"], "warnings": []})
            continue
        for t, d in parsed.items():
            ok, rep = validate_table(t, d)
            rep["file"] = name
            reports.append(rep)
            if ok is not None:
                tables.setdefault(t, []).append(ok)
    merged = {t: pd.concat(v, ignore_index=True) for t, v in tables.items()}
    # referential integrity
    ref = []
    if "cases" in merged and "alerts" in merged:
        orphan = ~merged["cases"].alert_id.isin(merged["alerts"].alert_id)
        if orphan.any():
            ref.append(f"{int(orphan.sum())} cases reference unknown alert_id")
    if "case_events" in merged and "cases" in merged:
        orphan = ~merged["case_events"].case_id.isin(merged["cases"].case_id)
        if orphan.any():
            ref.append(f"{int(orphan.sum())} case events reference unknown case_id")
    ok = all(not r["errors"] for r in reports) and {"alerts", "cases"} <= set(merged)
    if not {"alerts", "cases"} <= set(merged):
        ref.append("A submission must include at least alerts and cases")
    report = {"accepted": ok, "files": reports, "integrity": ref, "sha256": hashes}
    return (merged if ok else {}), report
