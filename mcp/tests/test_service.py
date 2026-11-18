from unittest.mock import Mock

import pytest

from dy_mcp.service import DouyinService
from dy_mcp.store import AccountStore


def make_service(tmp_path, creator_api):
    store = AccountStore(tmp_path / "douyin.db")
    store.set_account("测试账号")
    store.save_runtime({"DY_COOKIES": "sessionid=test"}, {"browser_type": "chrome"})
    session = Mock()
    session.get_auth.return_value = (Mock(), None)
    return DouyinService(store=store, session=session, creator_api=creator_api), session


def test_dry_run_checks_credentials_without_uploading(tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"video")
    creator_api = Mock()
    service, session = make_service(tmp_path, creator_api)

    result = service.publish_video(str(video), "标题", "简介", ["AI"], dry_run=True)

    assert result["status"] == "dry_run"
    assert result["desc"] == "简介 #AI"
    session.get_auth.assert_called_once_with(creator=True)
    creator_api._require_publish_security.assert_called_once()
    creator_api.post_video.assert_not_called()
    assert service.list_publications()["publications"][0]["status"] == "dry_run"


def test_publish_passes_cover_and_records_the_link(tmp_path):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"video")
    cover = tmp_path / "cover.png"
    cover.write_bytes(b"cover")
    creator_api = Mock()
    creator_api.post_video.return_value = (True, "发布成功", {"item_id": "123"})
    service, _session = make_service(tmp_path, creator_api)

    result = service.publish_video(str(video), "标题", cover=str(cover), visibility=1)

    assert result["status"] == "published"
    assert result["url"] == "https://www.douyin.com/video/123"
    kwargs = creator_api.post_video.call_args.kwargs
    assert kwargs["cover"] == str(cover.resolve())
    assert kwargs["visibility"] == 1
    assert kwargs["title"] == "标题"


def test_missing_video_file_is_rejected_before_any_request(tmp_path):
    creator_api = Mock()
    service, session = make_service(tmp_path, creator_api)

    with pytest.raises(FileNotFoundError):
        service.publish_video(str(tmp_path / "missing.mp4"), "标题")
    session.get_auth.assert_not_called()


def test_search_falls_back_to_video_tab_when_general_hits_verify_check(tmp_path):
    from dy_apis.douyin_api import SearchVerifyError

    api = Mock()
    api.search_some_general_work.side_effect = SearchVerifyError("verify_check")
    api.search_some_video_work.return_value = (
        [{"aweme_info": {"aweme_id": "1", "desc": "MCP 教程", "video": {"duration": 10000}}}],
        [],
    )
    service, _session = make_service(tmp_path, Mock())
    service._api = api

    result = service.search_videos("MCP", limit=5, sort_type="1")

    assert result["count"] == 1
    assert result["videos"][0]["aweme_id"] == "1"
    api.search_some_video_work.assert_called_once()
