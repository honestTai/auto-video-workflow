import json
import sqlite3

import pytest

from dy_mcp.store import AccountStore


def make_legacy_db(path):
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, browser_type TEXT, cdp_url TEXT, proxy_url TEXT);
        CREATE TABLE account_runtime (account_id TEXT PRIMARY KEY, runtime_env TEXT, runtime_info TEXT, updated_at TEXT);
        INSERT INTO accounts VALUES ('a1', '没凭证的账号', 'other', NULL, NULL);
        INSERT INTO accounts VALUES ('a2', '本机浏览器', 'webbridge', NULL, NULL);
        """
    )
    db.execute(
        "INSERT INTO account_runtime VALUES ('a2', ?, ?, '2026-01-01T00:00:00+00:00')",
        (json.dumps({"DY_COOKIES": "sessionid=test"}), json.dumps({"browser_type": "webbridge"})),
    )
    db.commit()
    db.close()


def test_single_account_is_replaced_not_duplicated(tmp_path):
    store = AccountStore(tmp_path / "douyin.db")
    store.set_account("第一个")
    account = store.set_account("第二个", "webbridge")

    assert account["name"] == "第二个"
    assert account["browser_type"] == "webbridge"
    assert account["runtime_status"] == "missing"


def test_runtime_is_saved_without_leaking_into_account(tmp_path):
    store = AccountStore(tmp_path / "douyin.db")
    store.set_account("账号")
    store.save_runtime({"DY_COOKIES": "sessionid=secret"}, {"browser_type": "chrome"})

    account = store.get_account()
    assert account["runtime_status"] == "saved"
    assert "secret" not in json.dumps(account, ensure_ascii=False)
    assert store.get_runtime()["env"]["DY_COOKIES"] == "sessionid=secret"


def test_import_picks_the_account_with_saved_runtime(tmp_path):
    source = tmp_path / "legacy.db"
    make_legacy_db(source)
    store = AccountStore(tmp_path / "douyin.db")

    account = store.import_from(source)

    assert account["name"] == "本机浏览器"
    assert account["runtime_status"] == "saved"
    assert store.get_runtime()["env"]["DY_COOKIES"] == "sessionid=test"


def test_import_rejects_account_without_runtime(tmp_path):
    source = tmp_path / "legacy.db"
    make_legacy_db(source)
    store = AccountStore(tmp_path / "douyin.db")

    with pytest.raises(ValueError):
        store.import_from(source, account="没凭证的账号")


def test_publications_are_recorded_newest_first(tmp_path):
    store = AccountStore(tmp_path / "douyin.db")
    for status in ("dry_run", "published"):
        store.add_publication(
            video_path="a.mp4", cover_path=None, item_title="标题", description="简介",
            visibility=0, timing=None, dry_run=status == "dry_run", status=status,
        )

    records = store.list_publications()
    assert [item["status"] for item in records] == ["published", "dry_run"]
