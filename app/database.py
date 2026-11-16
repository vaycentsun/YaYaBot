import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


TASK_FIELDS = (
    "name",
    "type",
    "script",
    "cron",
    "timezone",
    "enabled",
    "timeout",
    "mac",
    "broadcast",
    "port",
)


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self):
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    script TEXT NOT NULL DEFAULT '',
                    cron TEXT NOT NULL,
                    timezone TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    timeout INTEGER NOT NULL DEFAULT 300,
                    mac TEXT NOT NULL DEFAULT '',
                    broadcast TEXT NOT NULL DEFAULT '255.255.255.255',
                    port INTEGER NOT NULL DEFAULT 9,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    task_name TEXT NOT NULL,
                    trigger_kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    queued_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    exit_code INTEGER,
                    output TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_runs_task_id
                    ON runs(task_id, queued_at DESC);
                CREATE INDEX IF NOT EXISTS idx_runs_queued_at
                    ON runs(queued_at DESC);
                """
            )

    @staticmethod
    def _task(row):
        if row is None:
            return None
        item = dict(row)
        item["enabled"] = bool(item["enabled"])
        return item

    def list_tasks(self):
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC"
            ).fetchall()
        return [self._task(row) for row in rows]

    def get_task(self, task_id):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
        return self._task(row)

    def create_task(self, data):
        task_id = str(uuid.uuid4())
        now = utc_now()
        values = [data[field] for field in TASK_FIELDS]
        values[5] = int(values[5])
        with self._connect() as connection:
            connection.execute(
                f"""
                INSERT INTO tasks (
                    id, {', '.join(TASK_FIELDS)}, created_at, updated_at
                ) VALUES (?, {', '.join('?' for _ in TASK_FIELDS)}, ?, ?)
                """,
                (task_id, *values, now, now),
            )
        return self.get_task(task_id)

    def update_task(self, task_id, data):
        values = [data[field] for field in TASK_FIELDS]
        values[5] = int(values[5])
        with self._connect() as connection:
            cursor = connection.execute(
                f"""
                UPDATE tasks
                SET {', '.join(f'{field} = ?' for field in TASK_FIELDS)},
                    updated_at = ?
                WHERE id = ?
                """,
                (*values, utc_now(), task_id),
            )
        return self.get_task(task_id) if cursor.rowcount else None

    def delete_task(self, task_id):
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return cursor.rowcount > 0

    def create_run(self, task, trigger_kind):
        run_id = str(uuid.uuid4())
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO runs (id, task_id, task_name, trigger_kind, status, queued_at)
                VALUES (?, ?, ?, ?, 'queued', ?)
                """,
                (run_id, task["id"], task["name"], trigger_kind, utc_now()),
            )
        return self.get_run(run_id)

    def start_run(self, run_id):
        with self._connect() as connection:
            connection.execute(
                "UPDATE runs SET status = 'running', started_at = ? WHERE id = ?",
                (utc_now(), run_id),
            )

    def finish_run(self, run_id, status, output, exit_code=None):
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE runs
                SET status = ?, finished_at = ?, output = ?, exit_code = ?
                WHERE id = ?
                """,
                (status, utc_now(), output, exit_code, run_id),
            )

    def get_run(self, run_id):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runs WHERE id = ?", (run_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_runs(self, task_id=None, limit=100):
        query = "SELECT * FROM runs"
        parameters = []
        if task_id:
            query += " WHERE task_id = ?"
            parameters.append(task_id)
        query += " ORDER BY queued_at DESC LIMIT ?"
        parameters.append(limit)
        with self._connect() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [dict(row) for row in rows]

    def recover_interrupted_runs(self):
        message = "服务重启，执行被中断"
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE runs
                SET status = 'failed', finished_at = ?, output = ?
                WHERE status IN ('queued', 'running')
                """,
                (utc_now(), message),
            )
