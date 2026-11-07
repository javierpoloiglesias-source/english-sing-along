"""Base de datos SQLite local: medios subidos, transcripciones y cachés."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any

from . import config

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS media (
    hash TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    title TEXT,
    artist TEXT,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS transcripts (
    hash TEXT PRIMARY KEY,
    model TEXT,
    language TEXT,
    target_language TEXT,
    segments TEXT NOT NULL,
    edited INTEGER DEFAULT 0,
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS translation_cache (
    src TEXT, tgt TEXT, text TEXT, translation TEXT,
    PRIMARY KEY (src, tgt, text)
);
CREATE TABLE IF NOT EXISTS auto_cache (
    key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at REAL
);
CREATE TABLE IF NOT EXISTS youtube_cache (
    video_id TEXT PRIMARY KEY,
    ok INTEGER, title TEXT, author TEXT, checked_at REAL
);
"""


@contextmanager
def connect():
    with _lock:
        conn = sqlite3.connect(config.db_path())
        conn.row_factory = sqlite3.Row
        try:
            conn.executescript(SCHEMA)
            yield conn
            conn.commit()
        finally:
            conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


# ---- media -------------------------------------------------------------
def add_media(hash_: str, filename: str, stored_name: str, mime: str, size: int,
              title: str | None, artist: str | None) -> dict:
    with connect() as c:
        c.execute(
            "INSERT OR REPLACE INTO media VALUES (?,?,?,?,?,?,?,?)",
            (hash_, filename, stored_name, mime, size, title, artist, time.time()),
        )
    return get_media(hash_)


def get_media(hash_: str) -> dict | None:
    with connect() as c:
        return row_to_dict(c.execute("SELECT * FROM media WHERE hash=?", (hash_,)).fetchone())


def list_media() -> list[dict]:
    with connect() as c:
        return [dict(r) for r in c.execute("SELECT * FROM media ORDER BY created_at DESC")]


def delete_media(hash_: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM media WHERE hash=?", (hash_,))
        c.execute("DELETE FROM transcripts WHERE hash=?", (hash_,))


# ---- transcripts ---------------------------------------------------------
def save_transcript(hash_: str, segments: list[dict], model: str | None = None,
                    language: str = "en", target: str = "es", edited: bool = False) -> dict:
    now = time.time()
    with connect() as c:
        old = c.execute("SELECT created_at, model FROM transcripts WHERE hash=?", (hash_,)).fetchone()
        c.execute(
            "INSERT OR REPLACE INTO transcripts VALUES (?,?,?,?,?,?,?,?)",
            (hash_, model or (old["model"] if old else None), language, target,
             json.dumps(segments, ensure_ascii=False), int(edited),
             old["created_at"] if old else now, now),
        )
    return get_transcript(hash_)


def get_transcript(hash_: str) -> dict | None:
    with connect() as c:
        row = c.execute("SELECT * FROM transcripts WHERE hash=?", (hash_,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["segments"] = json.loads(d["segments"])
    d["edited"] = bool(d["edited"])
    return d


# ---- caches --------------------------------------------------------------
def cached_translations(src: str, tgt: str, texts: list[str]) -> dict[str, str]:
    if not texts:
        return {}
    out: dict[str, str] = {}
    with connect() as c:
        for t in set(texts):
            r = c.execute("SELECT translation FROM translation_cache WHERE src=? AND tgt=? AND text=?",
                          (src, tgt, t)).fetchone()
            if r:
                out[t] = r[0]
    return out


def store_translations(src: str, tgt: str, pairs: dict[str, str]) -> None:
    with connect() as c:
        c.executemany("INSERT OR REPLACE INTO translation_cache VALUES (?,?,?,?)",
                      [(src, tgt, k, v) for k, v in pairs.items()])


def get_youtube(video_id: str) -> dict | None:
    with connect() as c:
        return row_to_dict(c.execute("SELECT * FROM youtube_cache WHERE video_id=?", (video_id,)).fetchone())


def put_youtube(video_id: str, ok: bool, title: str | None, author: str | None) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO youtube_cache VALUES (?,?,?,?,?)",
                  (video_id, int(ok), title, author, time.time()))


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False)


def get_auto(key: str) -> dict | None:
    with connect() as c:
        r = c.execute("SELECT data FROM auto_cache WHERE key=?", (key,)).fetchone()
    return json.loads(r[0]) if r else None


def put_auto(key: str, data: dict) -> None:
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO auto_cache VALUES (?,?,?)", (key, json.dumps(data, ensure_ascii=False), time.time()))


def delete_auto(key_prefix: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM auto_cache WHERE key LIKE ?", (key_prefix + "%",))
