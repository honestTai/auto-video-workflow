from types import SimpleNamespace
from unittest.mock import patch

import pytest

from dy_apis import douyin_api
from dy_apis.douyin_api import DouyinAPI, SearchVerifyError, parse_aweme_id


class _Auth:
    cookie = {"s_v_web_id": "fp", "UIFID": "uifid"}
    webid = "webid"
    msToken = "mstoken"


@pytest.mark.parametrize("value", [
    "7433523124836060416",
    "https://www.douyin.com/video/7433523124836060416",
    "https://www.douyin.com/user/self?modal_id=7433523124836060416",
    "https://www.iesdouyin.com/share/video/7433523124836060416/?region=CN",
])
def test_parse_aweme_id_accepts_ids_and_links(value):
    assert parse_aweme_id(value) == (
        "7433523124836060416", "https://www.douyin.com/video/7433523124836060416",
    )


def test_parse_aweme_id_resolves_short_links_in_share_text():
    resolved = "https://www.iesdouyin.com/share/video/7433523124836060416/"
    with patch.object(douyin_api, "resolve_short_url", return_value=resolved) as resolve:
        aweme_id, _url = parse_aweme_id("7.43 复制打开抖音，看看 https://v.douyin.com/iAbCdEf/ 这条视频")

    assert aweme_id == "7433523124836060416"
    resolve.assert_called_once_with("https://v.douyin.com/iAbCdEf/")


def test_parse_aweme_id_rejects_unknown_text():
    with pytest.raises(ValueError):
        parse_aweme_id("https://example.com/not-a-video")


def test_general_search_sends_selected_filter_values():
    response = SimpleNamespace(text="{}", status_code=200, headers={}, json=lambda: {"data": []})
    with patch("dy_apis.douyin_api.generate_a_bogus_pure", return_value="ab"), \
            patch("dy_apis.douyin_api.requests.get", return_value=response) as request:
        DouyinAPI.search_general_work(
            _Auth(), "猫", sort_type="2", publish_time="7",
            filter_duration="1-5", search_range="3", content_type="2",
        )

    query = request.call_args.kwargs["params"]
    assert query["is_filter_search"] == "1"
    assert query["filter_selected"] == (
        '{"sort_type":"2","publish_time":"7",'
        '"filter_duration":"1-5","search_range":"3","content_type":"2"}'
    )


def test_general_search_raises_on_verify_check():
    payload = {"status_code": 0, "data": [], "search_nil_info": {"search_nil_type": "verify_check"}}
    response = SimpleNamespace(text="{}", status_code=200, headers={"X-Tt-Logid": "log1"}, json=lambda: payload)
    with patch("dy_apis.douyin_api.generate_a_bogus_pure", return_value="ab"), \
            patch("dy_apis.douyin_api.requests.get", return_value=response):
        with pytest.raises(SearchVerifyError):
            DouyinAPI.search_general_work(_Auth(), "MCP")
