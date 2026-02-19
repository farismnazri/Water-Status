"""Lightweight persistence layer.

Uses Postgres via asyncpg when DATABASE_URL is configured.
Falls back to SQLite when DATABASE_URL is missing.
"""

import asyncio
import json
import os
import re
import sqlite3
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, Awaitable, Callable
from uuid import uuid4

from dotenv import load_dotenv

if TYPE_CHECKING:
    import asyncpg

# Load backend/.env deterministically regardless of process CWD.
DOTENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=DOTENV_PATH)

DATABASE_URL = os.getenv("DATABASE_URL")
USE_POSTGRES = bool(DATABASE_URL)
ACTIVE_BACKEND = "postgres" if USE_POSTGRES else "sqlite"
SQLITE_PATH = os.getenv("SQLITE_PATH", os.path.join(os.path.dirname(__file__), "local_data.sqlite"))

COLLECTION_NAMES = (
    "sensors",
    "sensor_readings",
    "users",
    "reports",
    "user_reports",
)


def _is_valid_identifier(value: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value))


def _quote_identifier(value: str) -> str:
    if not _is_valid_identifier(value):
        raise ValueError(f"Invalid SQL identifier: {value!r}")
    return f'"{value}"'


def _load_asyncpg():
    try:
        import asyncpg
    except ImportError as exc:
        raise RuntimeError(
            "DATABASE_URL is set but asyncpg is not installed. "
            "Install dependencies from backend/requirements.txt."
        ) from exc
    return asyncpg


class _CollectionHelpers:
    @staticmethod
    def _match(doc: dict[str, Any], query: dict[str, Any]) -> bool:
        for k, v in (query or {}).items():
            dv = doc.get(k)

            # Support a small subset of query operators used in this app.
            if isinstance(v, dict):
                for op, op_val in v.items():
                    if hasattr(op_val, "isoformat"):
                        op_val = op_val.isoformat()
                    if hasattr(dv, "isoformat"):
                        dv_cmp = dv.isoformat()
                    else:
                        dv_cmp = dv

                    if op == "$gte":
                        if dv_cmp is None or dv_cmp < op_val:
                            return False
                    elif op == "$gt":
                        if dv_cmp is None or dv_cmp <= op_val:
                            return False
                    elif op == "$lte":
                        if dv_cmp is None or dv_cmp > op_val:
                            return False
                    elif op == "$lt":
                        if dv_cmp is None or dv_cmp >= op_val:
                            return False
                    elif op == "$in":
                        if dv_cmp not in op_val:
                            return False
                    else:
                        return False
                continue

            if hasattr(v, "isoformat"):
                v = v.isoformat()
            if hasattr(dv, "isoformat"):
                dv = dv.isoformat()
            if dv != v:
                return False
        return True

    @staticmethod
    def _encode_doc(doc: dict[str, Any]) -> dict[str, Any]:
        def enc_val(val: Any):
            if isinstance(val, (str, int, float, bool)) or val is None:
                return val
            if hasattr(val, "isoformat"):
                try:
                    return val.isoformat()
                except Exception:
                    pass
            if isinstance(val, list):
                return [enc_val(x) for x in val]
            if isinstance(val, dict):
                return {k: enc_val(v) for k, v in val.items()}
            return val

        return {k: enc_val(v) for k, v in doc.items()}


CursorLoader = Callable[[], Awaitable[list[dict[str, Any]]]]


class AsyncCursor:
    def __init__(
        self,
        docs: list[dict[str, Any]] | None = None,
        loader: CursorLoader | None = None,
    ):
        self._docs = docs
        self._loader = loader
        self._sort_fields: list[tuple[str, int]] = []
        self._limit: int | None = None
        self._materialized: list[dict[str, Any]] | None = None
        self._iter_index = 0

    def sort(self, key: str, direction: int = 1):
        self._sort_fields.append((key, direction))
        self._materialized = None
        return self

    def limit(self, n: int):
        self._limit = n
        self._materialized = None
        return self

    async def _materialize(self) -> list[dict[str, Any]]:
        if self._materialized is not None:
            return self._materialized

        if self._docs is not None:
            docs = list(self._docs)
        elif self._loader is not None:
            docs = list(await self._loader())
        else:
            docs = []

        for key, direction in reversed(self._sort_fields):
            reverse = direction == -1
            docs.sort(key=lambda d: d.get(key), reverse=reverse)

        if self._limit is not None:
            docs = docs[: self._limit]

        self._materialized = docs
        return self._materialized

    async def to_list(self, length: int | None = None):
        docs = await self._materialize()
        if length is None:
            return list(docs)
        return list(docs[:length])

    def __aiter__(self):
        self._iter_index = 0
        return self

    async def __anext__(self):
        docs = await self._materialize()
        if self._iter_index >= len(docs):
            raise StopAsyncIteration
        value = docs[self._iter_index]
        self._iter_index += 1
        return value


# ---------------------------------------------------------------------------
# SQLite fallback
# ---------------------------------------------------------------------------


class SQLiteCollection(_CollectionHelpers):
    def __init__(self, conn_path: str, name: str):
        self.conn_path = conn_path
        self.name = name
        self._ensure_table()

    def _ensure_table(self):
        with sqlite3.connect(self.conn_path) as conn:
            conn.execute(
                f"CREATE TABLE IF NOT EXISTS {_quote_identifier(self.name)} (\n"
                "  _id TEXT PRIMARY KEY,\n"
                "  doc TEXT NOT NULL\n"
                ")"
            )

    async def find_one(
        self,
        query: dict[str, Any],
        projection: dict[str, int] | None = None,
        sort: list[tuple[str, int]] | None = None,
    ):
        def _work():
            with sqlite3.connect(self.conn_path) as conn:
                rows = conn.execute(f"SELECT doc FROM {_quote_identifier(self.name)}").fetchall()

            matched_docs: list[dict[str, Any]] = []
            for (doc_str,) in rows:
                doc = json.loads(doc_str)
                if self._match(doc, query):
                    matched_docs.append(doc)

            if sort:
                for key, direction in reversed(sort):
                    reverse = direction == -1
                    matched_docs.sort(key=lambda d: d.get(key), reverse=reverse)

            if matched_docs:
                return matched_docs[0]
            return None

        return await asyncio.to_thread(_work)

    def find(self, query: dict[str, Any] | None = None):
        def _work():
            with sqlite3.connect(self.conn_path) as conn:
                rows = conn.execute(f"SELECT doc FROM {_quote_identifier(self.name)}").fetchall()
            docs = []
            for (doc_str,) in rows:
                doc = json.loads(doc_str)
                if self._match(doc, query or {}):
                    docs.append(doc)
            return docs

        docs = _work()
        return AsyncCursor(docs=docs)

    async def insert_one(self, doc: dict[str, Any]):
        encoded = self._encode_doc(doc)
        if "_id" not in encoded:
            encoded["_id"] = str(uuid4())

        def _work():
            with sqlite3.connect(self.conn_path) as conn:
                conn.execute(
                    f"INSERT OR REPLACE INTO {_quote_identifier(self.name)} (_id, doc) VALUES (?, ?)",
                    (str(encoded["_id"]), json.dumps(encoded)),
                )

        await asyncio.to_thread(_work)
        return SimpleNamespace(inserted_id=str(encoded["_id"]))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False):
        matched = 0
        modified = 0

        def _work():
            nonlocal matched, modified
            with sqlite3.connect(self.conn_path) as conn:
                rows = conn.execute(f"SELECT _id, doc FROM {_quote_identifier(self.name)}").fetchall()
                for _id, doc_str in rows:
                    doc = json.loads(doc_str)
                    if self._match(doc, query):
                        matched += 1
                        if "$set" in update:
                            doc.update(update["$set"])
                        elif update:
                            doc.update(update)
                        doc = self._encode_doc(doc)
                        conn.execute(
                            f"UPDATE {_quote_identifier(self.name)} SET doc=? WHERE _id=?",
                            (json.dumps(doc), _id),
                        )
                        modified += 1
                        return

                if matched == 0 and upsert:
                    new_doc = dict(update.get("$set", {}))
                    if "_id" not in new_doc:
                        new_doc["_id"] = str(uuid4())
                    new_doc = self._encode_doc(new_doc)
                    conn.execute(
                        f"INSERT INTO {_quote_identifier(self.name)} (_id, doc) VALUES (?, ?)",
                        (str(new_doc["_id"]), json.dumps(new_doc)),
                    )
                    matched = 1
                    modified = 1

        await asyncio.to_thread(_work)
        return SimpleNamespace(matched_count=matched, modified_count=modified)

    async def delete_one(self, query: dict[str, Any]):
        deleted = 0

        def _work():
            nonlocal deleted
            with sqlite3.connect(self.conn_path) as conn:
                rows = conn.execute(f"SELECT _id, doc FROM {_quote_identifier(self.name)}").fetchall()
                for _id, doc_str in rows:
                    doc = json.loads(doc_str)
                    if self._match(doc, query):
                        conn.execute(f"DELETE FROM {_quote_identifier(self.name)} WHERE _id=?", (_id,))
                        deleted = 1
                        return

        await asyncio.to_thread(_work)
        return SimpleNamespace(deleted_count=deleted)

    async def delete_many(self, query: dict[str, Any]):
        def _work():
            with sqlite3.connect(self.conn_path) as conn:
                rows = conn.execute(f"SELECT _id, doc FROM {_quote_identifier(self.name)}").fetchall()
                ids = []
                for _id, doc_str in rows:
                    doc = json.loads(doc_str)
                    if self._match(doc, query):
                        ids.append(_id)
                if ids:
                    conn.executemany(
                        f"DELETE FROM {_quote_identifier(self.name)} WHERE _id=?",
                        [(i,) for i in ids],
                    )
            return len(ids)

        deleted = await asyncio.to_thread(_work)
        return SimpleNamespace(deleted_count=deleted)


# ---------------------------------------------------------------------------
# Postgres backend (asyncpg)
# ---------------------------------------------------------------------------

_pg_pool: "asyncpg.Pool | None" = None
_pg_init_lock: asyncio.Lock | None = None
_pg_tables_ready = False


def _pg_lock() -> asyncio.Lock:
    global _pg_init_lock
    if _pg_init_lock is None:
        _pg_init_lock = asyncio.Lock()
    return _pg_init_lock


async def _get_pg_pool() -> "asyncpg.Pool":
    global _pg_pool, _pg_tables_ready

    if _pg_pool is not None and _pg_tables_ready:
        return _pg_pool

    async with _pg_lock():
        asyncpg = _load_asyncpg()
        if _pg_pool is None:
            if not DATABASE_URL:
                raise RuntimeError("DATABASE_URL is not configured")
            _pg_pool = await asyncpg.create_pool(DATABASE_URL)

        if not _pg_tables_ready:
            async with _pg_pool.acquire() as conn:
                for table_name in COLLECTION_NAMES:
                    table_ident = _quote_identifier(table_name)
                    await conn.execute(
                        f"CREATE TABLE IF NOT EXISTS {table_ident} ("
                        "_id TEXT PRIMARY KEY, "
                        "doc JSONB NOT NULL"
                        ")"
                    )
            _pg_tables_ready = True

    return _pg_pool


class PostgresCollection(_CollectionHelpers):
    def __init__(self, name: str):
        self.name = name
        self.table_ident = _quote_identifier(name)

    async def _fetch_all_docs(self) -> list[dict[str, Any]]:
        pool = await _get_pg_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(f"SELECT doc::text AS doc FROM {self.table_ident}")

        docs: list[dict[str, Any]] = []
        for row in rows:
            raw_doc = row["doc"]
            if isinstance(raw_doc, str):
                docs.append(json.loads(raw_doc))
            else:
                docs.append(json.loads(str(raw_doc)))
        return docs

    async def _upsert_doc(self, doc: dict[str, Any]) -> None:
        pool = await _get_pg_pool()
        encoded = self._encode_doc(doc)
        async with pool.acquire() as conn:
            await conn.execute(
                f"INSERT INTO {self.table_ident} (_id, doc) VALUES ($1, $2::jsonb) "
                "ON CONFLICT (_id) DO UPDATE SET doc = EXCLUDED.doc",
                str(encoded["_id"]),
                json.dumps(encoded),
            )

    async def find_one(
        self,
        query: dict[str, Any],
        projection: dict[str, int] | None = None,
        sort: list[tuple[str, int]] | None = None,
    ):
        docs = await self._fetch_all_docs()
        matched_docs = [doc for doc in docs if self._match(doc, query or {})]

        if sort:
            for key, direction in reversed(sort):
                reverse = direction == -1
                matched_docs.sort(key=lambda d: d.get(key), reverse=reverse)

        if matched_docs:
            return matched_docs[0]
        return None

    def find(self, query: dict[str, Any] | None = None):
        async def _load():
            docs = await self._fetch_all_docs()
            return [doc for doc in docs if self._match(doc, query or {})]

        return AsyncCursor(loader=_load)

    async def insert_one(self, doc: dict[str, Any]):
        encoded = self._encode_doc(doc)
        if "_id" not in encoded:
            encoded["_id"] = str(uuid4())
        await self._upsert_doc(encoded)
        return SimpleNamespace(inserted_id=str(encoded["_id"]))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False):
        docs = await self._fetch_all_docs()
        matched = 0
        modified = 0

        for doc in docs:
            if self._match(doc, query):
                matched = 1
                if "$set" in update:
                    doc.update(update["$set"])
                elif update:
                    doc.update(update)
                doc = self._encode_doc(doc)
                await self._upsert_doc(doc)
                modified = 1
                return SimpleNamespace(matched_count=matched, modified_count=modified)

        if upsert:
            new_doc = dict(update.get("$set", {}))
            if "_id" not in new_doc:
                new_doc["_id"] = str(uuid4())
            new_doc = self._encode_doc(new_doc)
            await self._upsert_doc(new_doc)
            matched = 1
            modified = 1

        return SimpleNamespace(matched_count=matched, modified_count=modified)

    async def delete_one(self, query: dict[str, Any]):
        docs = await self._fetch_all_docs()
        deleted = 0

        target_id: str | None = None
        for doc in docs:
            if self._match(doc, query):
                raw_id = doc.get("_id")
                if raw_id is not None:
                    target_id = str(raw_id)
                    break

        if target_id:
            pool = await _get_pg_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    f"DELETE FROM {self.table_ident} WHERE _id = $1",
                    target_id,
                )
            deleted = 1

        return SimpleNamespace(deleted_count=deleted)

    async def delete_many(self, query: dict[str, Any]):
        docs = await self._fetch_all_docs()
        matched_ids = []
        for doc in docs:
            if not self._match(doc, query):
                continue
            raw_id = doc.get("_id")
            if raw_id is None:
                continue
            matched_ids.append(str(raw_id))

        if matched_ids:
            pool = await _get_pg_pool()
            async with pool.acquire() as conn:
                await conn.executemany(
                    f"DELETE FROM {self.table_ident} WHERE _id = $1",
                    [(doc_id,) for doc_id in matched_ids],
                )

        return SimpleNamespace(deleted_count=len(matched_ids))


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------

client = None

if USE_POSTGRES:
    print("USING POSTGRES")
    db = SimpleNamespace()
    db.sensors = PostgresCollection("sensors")
    db.sensor_readings = PostgresCollection("sensor_readings")
    db.users = PostgresCollection("users")
    db.reports = PostgresCollection("reports")
    db.user_reports = PostgresCollection("user_reports")
else:
    print("USING SQLITE")
    db = SimpleNamespace()
    db.sensors = SQLiteCollection(SQLITE_PATH, "sensors")
    db.sensor_readings = SQLiteCollection(SQLITE_PATH, "sensor_readings")
    db.users = SQLiteCollection(SQLITE_PATH, "users")
    db.reports = SQLiteCollection(SQLITE_PATH, "reports")
    db.user_reports = SQLiteCollection(SQLITE_PATH, "user_reports")


async def ping_database() -> None:
    """Raise on connectivity failure."""
    if USE_POSTGRES:
        pool = await _get_pg_pool()
        async with pool.acquire() as conn:
            value = await conn.fetchval("SELECT 1")
        if value != 1:
            raise RuntimeError(f"Unexpected Postgres ping response: {value!r}")
        return

    def _sqlite_ping() -> None:
        with sqlite3.connect(SQLITE_PATH) as conn:
            row = conn.execute("SELECT 1").fetchone()
            if not row or row[0] != 1:
                raise RuntimeError("SQLite ping failed")

    await asyncio.to_thread(_sqlite_ping)
