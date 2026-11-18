import pytest

from dy_mcp.service import build_publish_text, normalize_tags


def test_tags_are_normalized_and_deduplicated():
    assert normalize_tags(["AI", "#MCP", "AI", "Claude Code，vibecoding"]) == [
        "#AI", "#MCP", "#Claude", "#Code", "#vibecoding",
    ]


def test_short_title_is_kept_and_tags_appended():
    title, desc = build_publish_text("别再瞎装 MCP 了", "三条避坑铁律", ["AI", "MCP"])

    assert title == "别再瞎装 MCP 了"
    assert desc == "三条避坑铁律 #AI #MCP"


def test_long_title_moves_into_desc_and_is_truncated():
    long_title = "为什么你的 AI 装了三十六个 MCP 之后反而越用越慢"
    title, desc = build_publish_text(long_title, "看完这期就懂了", ["MCP"])

    assert len(title) <= 20
    assert long_title.startswith(title)
    assert desc.startswith(long_title + "\n看完这期就懂了")
    assert desc.endswith("#MCP")


def test_tags_already_in_desc_are_not_repeated():
    _title, desc = build_publish_text("标题", "正文 #AI", ["AI", "MCP"])

    assert desc == "正文 #AI #MCP"


def test_empty_title_is_rejected():
    with pytest.raises(ValueError):
        build_publish_text("  ", "正文")
