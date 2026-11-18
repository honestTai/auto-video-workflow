from unittest.mock import Mock

import pytest

from dy_mcp.cli import main as cli_main
from dy_mcp.service import DouyinService, extract_item_id
from dy_mcp.store import AccountStore
from utils.data_util import (
    normalize_creator_metrics,
    summarize_creator_overview,
    summarize_item_diagnosis,
)


def make_service(tmp_path, creator_api):
    store = AccountStore(tmp_path / "douyin.db")
    store.set_account("测试账号")
    store.save_runtime({"DY_COOKIES": "sessionid=test"}, {"browser_type": "chrome"})
    session = Mock()
    session.get_auth.return_value = (Mock(), None)
    return DouyinService(store=store, session=session, creator_api=creator_api), session


def test_extract_item_id_supports_digits_and_urls():
    assert extract_item_id("7700793742185303332") == "7700793742185303332"
    assert extract_item_id("https://www.douyin.com/video/7700793742185303332") == "7700793742185303332"
    assert extract_item_id("https://www.douyin.com/user/abc?modal_id=7700793742185303332") == "7700793742185303332"
    assert extract_item_id("https://creator.douyin.com/creator-micro/work-management/work-detail/7700793742185303332") == "7700793742185303332"
    with pytest.raises(ValueError):
        extract_item_id("not-a-valid-id")


def test_normalize_creator_metrics_computes_5s_bounce_rate():
    metrics = normalize_creator_metrics({
        "view_count": "1000",
        "bounce_rate_2s": "0.320000",
        "completion_rate_5s": "0.360000",
        "completion_rate": "0.085000",
        "avg_view_second": "14.567",
        "avg_view_proportion": "0.180000",
        "like_count": "30",
        "like_rate": "0.030000",
    })
    assert metrics["view_count"] == 1000
    assert metrics["bounce_rate_2s"] == 0.32
    assert metrics["completion_rate_5s"] == 0.36
    assert metrics["bounce_rate_5s"] == 0.64
    assert metrics["avg_view_second"] == 14.57

    zero_metrics = normalize_creator_metrics({"view_count": "0", "completion_rate_5s": "0"})
    assert zero_metrics["view_count"] == 0
    assert zero_metrics["bounce_rate_5s"] is None
    assert zero_metrics["bounce_rate_2s"] is None


def test_get_account_analytics_summarizes_baseline_and_flags_5s_bounce(tmp_path):
    creator_api = Mock()
    creator_api.get_creator_item_list.return_value = [
        {
            "id": "1000000000000000001",
            "description": "新发未跑量视频\n#AI",
            "create_time": 1795000000,
            "video_info": {"duration": "85000"},
            "metrics": {"view_count": "3", "bounce_rate_2s": "0.5", "completion_rate_5s": "0.2"},
        },
        {
            "id": "1000000000000000002",
            "description": "已跑量作品A\n#AI",
            "create_time": 1794000000,
            "video_info": {"duration": "90000"},
            "metrics": {
                "view_count": "1200",
                "bounce_rate_2s": "0.38",
                "completion_rate_5s": "0.30",
                "completion_rate": "0.05",
                "avg_view_second": "9.5",
                "avg_view_proportion": "0.09",
                "comment_rate": "0.0002",
                "favorite_rate": "0.002",
                "subscribe_rate": "0.0005",
            },
        },
    ]
    service, session = make_service(tmp_path, creator_api)

    result = service.get_account_analytics(limit=10, sort_by="latest", min_views=20)

    session.get_auth.assert_called_once_with(creator=True)
    assert result["count"] == 2
    assert result["overview"]["sample_count"] == 1
    assert result["overview"]["averages"]["avg_bounce_rate_5s"] == 0.7
    assert any("5 秒跳出率偏高" in item for item in result["overview"]["diagnostics"])


def test_get_video_diagnosis_marks_lower_bounce_as_better(tmp_path):
    creator_api = Mock()
    creator_api.get_creator_item_compare.return_value = {
        "compare_hour": "72",
        "item": {
            "id": "7700793742185303332",
            "description": "测试作品",
            "create_time": 1792980769,
            "metrics": {
                "view_count": "2973",
                "bounce_rate_2s": "0.28",
                "completion_rate_5s": "0.40",
                "completion_rate": "0.08",
            },
        },
        "view_count_metric": {
            "name": "view_count",
            "name_desc": "播放量",
            "self_value": "2973",
            "compare_value": "1000",
            "change_ratio": 1.973,
            "is_compare": True,
        },
        "metrics": [
            {
                "name": "bounce_rate_2s",
                "name_desc": "2秒跳出率",
                "self_value": "0.28",
                "compare_value": "0.42",
                "change_ratio": -0.3333,
                "is_compare": True,
            },
            {
                "name": "completion_rate_5s",
                "name_desc": "5秒完播率",
                "self_value": "0.40",
                "compare_value": "0.25",
                "change_ratio": 0.6,
                "is_compare": True,
            },
            {
                "name": "comment_rate",
                "name_desc": "评论率",
                "self_value": "0.0001",
                "compare_value": "0.0020",
                "change_ratio": -0.95,
                "is_compare": True,
            },
        ],
    }
    creator_api.get_creator_item_play_source.return_value = {
        "play_source": [
            {"key": "homepage_hot", "value": 0.92, "history_difference": 0.15},
            {"key": "search", "value": 0.08, "history_difference": -0.05},
        ],
    }
    service, _session = make_service(tmp_path, creator_api)

    diag = service.get_video_diagnosis("https://www.douyin.com/video/7700793742185303332")

    by_name = {b["name"]: b for b in diag["benchmarks"]}
    assert by_name["bounce_rate_2s"]["status"] == "better"
    assert by_name["bounce_rate_5s"]["self_value"] == 0.6
    assert by_name["bounce_rate_5s"]["compare_value"] == 0.75
    assert by_name["bounce_rate_5s"]["status"] == "better"
    assert by_name["comment_rate"]["status"] == "worse"
    assert diag["play_sources"][0]["label"] == "推荐页"
    assert any("评论率" in w for w in diag["weaknesses"])


def test_cli_analytics_and_diagnose_commands(tmp_path, capsys):
    creator_api = Mock()
    creator_api.get_creator_item_list.return_value = []
    creator_api.get_creator_item_compare.return_value = {"item": {"id": "7700793742185303332", "metrics": {}}}
    creator_api.get_creator_item_play_source.return_value = {"play_source": []}
    service, _session = make_service(tmp_path, creator_api)

    assert cli_main(["analytics", "--limit", "5", "--sort", "play"], service=service) == 0
    assert '"count": 0' in capsys.readouterr().out

    assert cli_main(["diagnose", "7700793742185303332"], service=service) == 0
    assert "7700793742185303332" in capsys.readouterr().out
