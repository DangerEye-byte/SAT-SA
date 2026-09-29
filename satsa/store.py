"""DuckDB storage: canonical tables + analysis outputs."""

from __future__ import annotations

import os
import threading
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DB_PATH = Path(os.environ.get("SATSA_DB", DATA / "satsa.duckdb"))

CANONICAL = ["entities", "assets", "alerts", "cases", "case_events", "escalations", "submissions", "redteam"]

_lock = threading.RLock()


POINTER = DATA / "current_db.txt"  # set when an ingest commit produced a newer database


def live_db_path() -> Path:
    """The database the API should serve: the newest committed run, else the default."""
    if POINTER.exists():
        p = Path(POINTER.read_text().strip())
        if p.exists():
            return p
    return DB_PATH


def connect(read_only: bool = False, path: Path | None = None) -> duckdb.DuckDBPyConnection:
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    return duckdb.connect(str(path), read_only=read_only)


def write_tables(tables: dict[str, pd.DataFrame], con=None) -> None:
    own = con is None
    con = con or connect()
    with _lock:
        for name, df in tables.items():
            con.register("_tmp_df", df)
            con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM _tmp_df")
            con.unregister("_tmp_df")
    if own:
        con.close()


def load_parquet_dir(folder: str | Path, con=None) -> dict[str, int]:
    folder = Path(folder)
    own = con is None
    con = con or connect()
    counts = {}
    with _lock:
        for name in CANONICAL:
            f = folder / f"{name}.parquet"
            if f.exists():
                con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM read_parquet('{f.as_posix()}')")
                counts[name] = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
    if own:
        con.close()
    return counts


def df(sql: str, params=None, con=None) -> pd.DataFrame:
    own = con is None
    con = con or connect(read_only=False)
    with _lock:
        out = con.execute(sql, params or []).df()
    if own:
        con.close()
    return out
