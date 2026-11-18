"""单账号凭证与发布记录的本地 SQLite 存储。

只保存一个抖音账号：`account` 是账号绑定信息，`account_runtime` 是从浏览器采集的
登录凭证（Cookie、ticket、设备指纹），`publications` 是发布记录。数据库默认在
mcp/.data/douyin.db，可用环境变量 DOUYIN_MCP_DB_PATH 改位置；该文件含登录凭证，勿入库。
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
BROWSER_TYPES = ("chrome", "webbridge")
DEFAULT_CDP_URL = "http://127.0.0.1:9222"


def default_db_path():
    return Path(os.getenv("DOUYIN_MCP_DB_PATH") or ROOT / ".data" / "douyin.db")


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class AccountStore:
    def __init__(self, path=None):
        self.path = Path(path) if path else default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self):
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS account (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    name TEXT NOT NULL,
                    browser_type TEXT NOT NULL DEFAULT 'chrome',
                    cdp_url TEXT,
                    proxy_url TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS account_runtime (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    runtime_env TEXT NOT NULL,
                    runtime_info TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS publications (
                    id TEXT PRIMARY KEY,
                    video_path TEXT NOT NULL,
                    cover_path TEXT,
                    item_title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    visibility INTEGER NOT NULL,
                    timing INTEGER,
                    dry_run INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    aweme_id TEXT,
                    url TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_publications_time ON publications(created_at);
                """
            )

    # ---------- 账号 ----------
    def set_account(self, name, browser_type="chrome", cdp_url="", proxy_url=""):
        name = str(name or "").strip()
        browser_type = str(browser_type or "chrome").strip().lower()
        cdp_url = str(cdp_url or "").strip()
        proxy_url = str(proxy_url or "").strip()
        if not name:
            raise ValueError("账号名称不能为空")
        if browser_type not in BROWSER_TYPES:
            raise ValueError("browser_type 只支持 chrome 或 webbridge")
        now = utc_now()
        with self.connect() as db:
            db.execute(
                """
                INSERT INTO account(id, name, browser_type, cdp_url, proxy_url, created_at, updated_at)
                VALUES (1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, browser_type=excluded.browser_type,
                    cdp_url=excluded.cdp_url, proxy_url=excluded.proxy_url,
                    status='active', last_error=NULL, updated_at=excluded.updated_at
                """,
                (name, browser_type, cdp_url or None, proxy_url or None, now, now),
            )
        return self.get_account()

    def get_account(self):
        """返回账号绑定信息与凭证状态；不包含任何凭证内容。"""
        with self.connect() as db:
            row = db.execute("SELECT * FROM account WHERE id=1").fetchone()
            if row is None:
                return None
            runtime = db.execute(
                "SELECT runtime_info, updated_at FROM account_runtime WHERE id=1"
            ).fetchone()
        account = {key: row[key] for key in row.keys() if key != "id"}
        account["cdp_url"] = account["cdp_url"] or ""
        account["proxy_url"] = "已配置" if account["proxy_url"] else ""
        account["runtime_status"] = "saved" if runtime else "missing"
        account["runtime_saved_at"] = runtime["updated_at"] if runtime else None
        account["runtime_info"] = json.loads(runtime["runtime_info"]) if runtime else None
        return account

    def account_proxy(self):
        with self.connect() as db:
            row = db.execute("SELECT proxy_url FROM account WHERE id=1").fetchone()
        return (row["proxy_url"] if row else None) or None

    def set_account_status(self, status, error=None):
        with self.connect() as db:
            db.execute(
                "UPDATE account SET status=?, last_error=?, updated_at=? WHERE id=1",
                (status, error, utc_now()),
            )

    # ---------- 登录凭证 ----------
    def save_runtime(self, runtime_env, runtime_info):
        if self.get_account() is None:
            raise ValueError("尚未绑定账号，请先调用 set_account")
        now = utc_now()
        with self.connect() as db:
            db.execute(
                "INSERT INTO account_runtime(id, runtime_env, runtime_info, updated_at) "
                "VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                "runtime_env=excluded.runtime_env, runtime_info=excluded.runtime_info, "
                "updated_at=excluded.updated_at",
                (json.dumps(runtime_env), json.dumps(runtime_info, ensure_ascii=False), now),
            )
        return now

    def get_runtime(self):
        with self.connect() as db:
            row = db.execute(
                "SELECT runtime_env, runtime_info, updated_at FROM account_runtime WHERE id=1"
            ).fetchone()
        if not row:
            return None
        return {
            "env": json.loads(row["runtime_env"]),
            "info": json.loads(row["runtime_info"]),
            "saved_at": row["updated_at"],
        }

    # ---------- 发布记录 ----------
    def add_publication(self, *, video_path, cover_path, item_title, description, visibility,
                        timing, dry_run, status, aweme_id="", url="", error=None):
        record_id = uuid.uuid4().hex[:12]
        with self.connect() as db:
            db.execute(
                "INSERT INTO publications(id, video_path, cover_path, item_title, description, "
                "visibility, timing, dry_run, status, aweme_id, url, error, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (record_id, str(video_path), str(cover_path) if cover_path else None, item_title,
                 description, int(visibility), timing, int(bool(dry_run)), status,
                 aweme_id or None, url or None, error, utc_now()),
            )
        return record_id

    def list_publications(self, limit=20):
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM publications ORDER BY created_at DESC LIMIT ?", (int(limit),)
            ).fetchall()
        records = []
        for row in rows:
            item = dict(row)
            item["dry_run"] = bool(item["dry_run"])
            records.append(item)
        return records

    # ---------- 从旧数据库导入 ----------
    def import_from(self, source_db, account=""):
        """从另一个账号数据库（多账号版 `accounts` 表，或本项目的 `account` 表）只读导入一个账号。

        `account` 为账号 id 或名称；不传时选已保存凭证、且凭证最新的那个账号。
        源数据库以 `mode=ro` 打开，不会被修改。
        """
        source_path = Path(source_db).expanduser().resolve()
        if not source_path.is_file():
            raise FileNotFoundError(f"源数据库不存在: {source_path}")
        if source_path == self.path.resolve():
            raise ValueError("源数据库和当前数据库是同一个文件")
        source = sqlite3.connect(f"{source_path.as_uri()}?mode=ro", uri=True, timeout=30)
        source.row_factory = sqlite3.Row
        try:
            tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "accounts" in tables:
                rows = source.execute(
                    "SELECT a.id AS key, a.name, a.browser_type, a.cdp_url, a.proxy_url, "
                    "r.runtime_env, r.runtime_info, r.updated_at AS runtime_saved_at "
                    "FROM accounts a LEFT JOIN account_runtime r ON r.account_id = a.id "
                    "ORDER BY r.updated_at IS NULL, r.updated_at DESC"
                ).fetchall()
            elif "account" in tables:
                rows = source.execute(
                    "SELECT '1' AS key, a.name, a.browser_type, a.cdp_url, a.proxy_url, "
                    "r.runtime_env, r.runtime_info, r.updated_at AS runtime_saved_at "
                    "FROM account a LEFT JOIN account_runtime r ON r.id = a.id"
                ).fetchall()
            else:
                raise ValueError("源数据库里没有账号表（accounts / account）")
        finally:
            source.close()

        wanted = str(account or "").strip()
        if wanted:
            rows = [row for row in rows if wanted in (str(row["key"]), row["name"])]
            if not rows:
                raise ValueError(f"源数据库里没有账号: {wanted}")
        chosen = next((row for row in rows if row["runtime_env"]), None)
        if chosen is None:
            if not rows:
                raise ValueError("源数据库里没有账号")
            raise ValueError("源数据库里的账号都还没有保存登录凭证，无法导入")

        browser_type = chosen["browser_type"] if chosen["browser_type"] in BROWSER_TYPES else "chrome"
        self.set_account(chosen["name"], browser_type, chosen["cdp_url"] or "", chosen["proxy_url"] or "")
        with self.connect() as db:
            db.execute(
                "INSERT INTO account_runtime(id, runtime_env, runtime_info, updated_at) "
                "VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                "runtime_env=excluded.runtime_env, runtime_info=excluded.runtime_info, "
                "updated_at=excluded.updated_at",
                (chosen["runtime_env"], chosen["runtime_info"], chosen["runtime_saved_at"]),
            )
        return self.get_account()
