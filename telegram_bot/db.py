import os
import sqlite3
import time
from contextlib import closing

DB_PATH = os.getenv("DB_PATH", "data/lembretes.db")


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init():
    folder = os.path.dirname(DB_PATH)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with closing(_conn()) as c, c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id     INTEGER NOT NULL,
                text        TEXT    NOT NULL,
                due_at      INTEGER NOT NULL,          -- unix timestamp (UTC)
                status      TEXT    NOT NULL DEFAULT 'scheduled',  -- scheduled | nagging | done | canceled
                last_nag_at INTEGER,
                nag_count   INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                done_at     INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_at);
            CREATE TABLE IF NOT EXISTS nag_messages (
                chat_id    INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                task_id    INTEGER NOT NULL,
                PRIMARY KEY (chat_id, message_id)
            );
            """
        )


def add_task(chat_id, text, due_at):
    with closing(_conn()) as c, c:
        cur = c.execute(
            "INSERT INTO tasks (chat_id, text, due_at, created_at) VALUES (?, ?, ?, ?)",
            (chat_id, text, due_at, int(time.time())),
        )
        return cur.lastrowid


def get_task(task_id, chat_id):
    with closing(_conn()) as c:
        return c.execute(
            "SELECT * FROM tasks WHERE id = ? AND chat_id = ?", (task_id, chat_id)
        ).fetchone()


def due_for_nag(now, interval_s):
    """Tasks whose time has come and that weren't nagged in the last interval."""
    with closing(_conn()) as c:
        return c.execute(
            """SELECT * FROM tasks
               WHERE status IN ('scheduled', 'nagging')
                 AND due_at <= ?
                 AND (last_nag_at IS NULL OR last_nag_at <= ?)
               ORDER BY due_at""",
            (now, now - interval_s),
        ).fetchall()


def mark_nagged(task_id, chat_id, message_id, now):
    with closing(_conn()) as c, c:
        c.execute(
            """UPDATE tasks SET status = 'nagging', last_nag_at = ?, nag_count = nag_count + 1
               WHERE id = ?""",
            (now, task_id),
        )
        c.execute(
            "INSERT OR REPLACE INTO nag_messages (chat_id, message_id, task_id) VALUES (?, ?, ?)",
            (chat_id, message_id, task_id),
        )


def task_by_message(chat_id, message_id):
    with closing(_conn()) as c:
        return c.execute(
            """SELECT t.* FROM nag_messages m JOIN tasks t ON t.id = m.task_id
               WHERE m.chat_id = ? AND m.message_id = ?""",
            (chat_id, message_id),
        ).fetchone()


def set_status(task_id, chat_id, status):
    """Close a task (done/canceled). Returns the task if it was open, else None."""
    with closing(_conn()) as c, c:
        cur = c.execute(
            """UPDATE tasks SET status = ?, done_at = ?
               WHERE id = ? AND chat_id = ? AND status IN ('scheduled', 'nagging')""",
            (status, int(time.time()), task_id, chat_id),
        )
        if cur.rowcount == 0:
            return None
    return get_task(task_id, chat_id)


def snooze(task_id, chat_id, until):
    with closing(_conn()) as c, c:
        cur = c.execute(
            """UPDATE tasks SET due_at = ?, status = 'scheduled', last_nag_at = NULL
               WHERE id = ? AND chat_id = ? AND status IN ('scheduled', 'nagging')""",
            (until, task_id, chat_id),
        )
        return cur.rowcount > 0


def nagging(chat_id):
    with closing(_conn()) as c:
        return c.execute(
            "SELECT * FROM tasks WHERE chat_id = ? AND status = 'nagging' ORDER BY due_at",
            (chat_id,),
        ).fetchall()


def open_tasks(chat_id):
    with closing(_conn()) as c:
        return c.execute(
            """SELECT * FROM tasks WHERE chat_id = ? AND status IN ('scheduled', 'nagging')
               ORDER BY due_at""",
            (chat_id,),
        ).fetchall()
