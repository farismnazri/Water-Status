"""Lightweight persistence layer.

Defaults to SQLite only when no Mongo URL is configured.
Set USE_SQLITE=1 to force SQLite even when MONGO_URL exists.
"""

import asyncio
import json
import os
import sqlite3
from types import SimpleNamespace
from typing import Any, Iterable

from bson import ObjectId
from dotenv import load_dotenv

# Load .env from the Backend folder
load_dotenv()

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("MONGO_DB_NAME", "water_status")
_use_sqlite_raw = os.getenv("USE_SQLITE")
if _use_sqlite_raw is None:
    USE_SQLITE = not bool(MONGO_URL)
else:
    USE_SQLITE = _use_sqlite_raw.lower() in {"1", "true", "yes"}


# ---------------------------------------------------------------------------
# SQLite fallback (default)
# ---------------------------------------------------------------------------

class AsyncCursor:
    def __init__(self, docs: list[dict[str, Any]]):
        self.docs = docs

    def sort(self, key: str, direction: int = 1):
        reverse = direction == -1
        self.docs = sorted(self.docs, key=lambda d: d.get(key), reverse=reverse)
        return self

    def limit(self, n: int):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, length: int | None = None):
        if length is None:
            return list(self.docs)
        return list(self.docs[:length])

    def __aiter__(self):
        self._iter = iter(self.docs)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration


class SQLiteCollection:
    def __init__(self, conn_path: str, name: str):
        self.conn_path = conn_path
        self.name = name
        self._ensure_table()

    def _ensure_table(self):
        with sqlite3.connect(self.conn_path) as conn:
            conn.execute(
                f"CREATE TABLE IF NOT EXISTS {self.name} (\n"
                "  _id TEXT PRIMARY KEY,\n"
                "  doc TEXT NOT NULL\n"
                ")"
            )

    @staticmethod
    def _match(doc: dict[str, Any], query: dict[str, Any]) -> bool:
        for k, v in (query or {}).items():
            dv = doc.get(k)
            if isinstance(dv, ObjectId):
                dv = str(dv)
            if isinstance(v, ObjectId):
                v = str(v)

            # Support a small subset of Mongo-style operators used in this app.
            if isinstance(v, dict):
                for op, op_val in v.items():
                    if isinstance(op_val, ObjectId):
                        op_val = str(op_val)
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
            if isinstance(val, ObjectId):
                return str(val)
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

    async def find_one(
        self,
        query: dict[str, Any],
        projection: dict[str, int] | None = None,
        sort: list[tuple[str, int]] | None = None,
    ):
        def _work():
            with sqlite3.connect(self.conn_path) as conn:
                rows = conn.execute(f"SELECT doc FROM {self.name}").fetchall()

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
                rows = conn.execute(f"SELECT doc FROM {self.name}").fetchall()
            docs = []
            for (doc_str,) in rows:
                doc = json.loads(doc_str)
                if self._match(doc, query or {}):
                    docs.append(doc)
            return docs

        docs = _work()
        return AsyncCursor(docs)

    async def insert_one(self, doc: dict[str, Any]):
        encoded = self._encode_doc(doc)
        if "_id" not in encoded:
            encoded["_id"] = str(ObjectId())

        def _work():
            with sqlite3.connect(self.conn_path) as conn:
                conn.execute(
                    f"INSERT OR REPLACE INTO {self.name} (_id, doc) VALUES (?, ?)",
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
                rows = conn.execute(f"SELECT _id, doc FROM {self.name}").fetchall()
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
                            f"UPDATE {self.name} SET doc=? WHERE _id=?",
                            (json.dumps(doc), _id),
                        )
                        modified += 1
                        return

                if matched == 0 and upsert:
                    new_doc = dict(update.get("$set", {}))
                    if "_id" not in new_doc:
                        new_doc["_id"] = str(ObjectId())
                    new_doc = self._encode_doc(new_doc)
                    conn.execute(
                        f"INSERT INTO {self.name} (_id, doc) VALUES (?, ?)",
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
                rows = conn.execute(f"SELECT _id, doc FROM {self.name}").fetchall()
                for _id, doc_str in rows:
                    doc = json.loads(doc_str)
                    if self._match(doc, query):
                        conn.execute(f"DELETE FROM {self.name} WHERE _id=?", (_id,))
                        deleted = 1
                        return

        await asyncio.to_thread(_work)
        return SimpleNamespace(deleted_count=deleted)

    async def delete_many(self, query: dict[str, Any]):
        def _work():
            with sqlite3.connect(self.conn_path) as conn:
                rows = conn.execute(f"SELECT _id, doc FROM {self.name}").fetchall()
                ids = []
                for _id, doc_str in rows:
                    doc = json.loads(doc_str)
                    if self._match(doc, query):
                        ids.append(_id)
                if ids:
                    conn.executemany(f"DELETE FROM {self.name} WHERE _id=?", [(i,) for i in ids])
            return len(ids)

        deleted = await asyncio.to_thread(_work)
        return SimpleNamespace(deleted_count=deleted)


if USE_SQLITE or not MONGO_URL:
    DB_PATH = os.getenv("SQLITE_PATH", os.path.join(os.path.dirname(__file__), "local_data.sqlite"))

    # Build a namespace that mimics the Mongo db object
    db = SimpleNamespace()
    db.sensors = SQLiteCollection(DB_PATH, "sensors")
    db.sensor_readings = SQLiteCollection(DB_PATH, "sensor_readings")
    db.users = SQLiteCollection(DB_PATH, "users")
    db.reports = SQLiteCollection(DB_PATH, "reports")
    db.user_reports = SQLiteCollection(DB_PATH, "user_reports")
    client = None
else:
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
