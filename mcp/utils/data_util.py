"""作品数据整理与媒体下载（不依赖 openpyxl）。"""
import os
import re

import requests
from retry import retry


# douyinvod.com 视频 CDN 不带 Referer 会返回 403，图片 CDN 不校验
MEDIA_HEADERS = {"Referer": "https://www.douyin.com/"}


def norm_str(text):
    """去掉不能出现在文件名里的字符。"""
    return re.sub(r"[\\/:*?\"<>|\s]+", "", str(text or ""))


def as_count(value):
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def as_float(value, digits=6):
    try:
        if value in (None, ""):
            return 0.0
        return round(float(value), digits)
    except (TypeError, ValueError):
        return 0.0


PLAY_SOURCE_LABELS = {
    "homepage_hot": "推荐页",
    "search": "搜索",
    "homepage": "个人主页",
    "follow": "关注",
    "familiar": "朋友页",
    "message": "私信/转发",
    "compilation": "合集",
    "other": "其他",
}

LOWER_IS_BETTER_METRICS = {"bounce_rate_2s", "bounce_rate_5s", "dislike_rate"}


def _first_url(node):
    urls = (node or {}).get("url_list") or []
    return urls[0] if urls else ""


def video_urls(aweme):
    """按优先级返回可下载的无水印视频地址：先 play_addr，再各码率备选。"""
    video = aweme.get("video") or {}
    urls = list((video.get("play_addr") or {}).get("url_list") or [])
    for rate in sorted(video.get("bit_rate") or [], key=lambda item: -as_count(item.get("bit_rate"))):
        urls.extend((rate.get("play_addr") or {}).get("url_list") or [])
    seen = []
    for url in urls:
        if url and url not in seen:
            seen.append(url)
    return seen


def summarize_work(aweme):
    """把接口返回的一条作品压成 Agent 好读的摘要（不含播放地址签名等长字段）。"""
    author = aweme.get("author") or {}
    stats = aweme.get("statistics") or {}
    video = aweme.get("video") or {}
    aweme_id = str(aweme.get("aweme_id") or "")
    topics = []
    for item in aweme.get("text_extra") or []:
        name = item.get("hashtag_name")
        if name and name not in topics:
            topics.append(name)
    images = aweme.get("images")
    duration_ms = as_count(video.get("duration") or aweme.get("duration"))
    return {
        "aweme_id": aweme_id,
        "url": f"https://www.douyin.com/video/{aweme_id}" if aweme_id else "",
        "type": "images" if isinstance(images, list) and images else "video",
        "desc": aweme.get("desc") or "",
        "topics": topics,
        "create_time": as_count(aweme.get("create_time")),
        "duration_seconds": round(duration_ms / 1000, 1) if duration_ms else 0,
        "author": {
            "nickname": author.get("nickname") or "",
            "sec_uid": author.get("sec_uid") or "",
            "follower_count": as_count(author.get("follower_count")),
        },
        "stats": {
            "digg": as_count(stats.get("digg_count")),
            "comment": as_count(stats.get("comment_count")),
            "collect": as_count(stats.get("collect_count")),
            "share": as_count(stats.get("share_count")),
        },
        "cover": _first_url(video.get("cover")),
    }


@retry(tries=3, delay=1)
def download_file(url, path, *, headers=None, chunk_size=1024 * 1024):
    """流式下载到 path，返回写入的字节数。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    response = requests.get(url, headers=headers or MEDIA_HEADERS, stream=True, timeout=60)
    response.raise_for_status()
    size = 0
    partial = f"{path}.part"
    with open(partial, "wb") as file:
        for chunk in response.iter_content(chunk_size=chunk_size):
            if chunk:
                file.write(chunk)
                size += len(chunk)
    if size <= 0:
        os.remove(partial)
        raise RuntimeError("下载到的文件为空")
    os.replace(partial, path)
    return size


def normalize_creator_metrics(raw):
    """标准化创作者中心单条作品的播放、留存（含 2s/5s 跳出率）、完播与互动指标。"""
    metrics = raw or {}
    views = as_count(metrics.get("view_count"))
    completion_5s = as_float(metrics.get("completion_rate_5s"))
    bounce_5s = round(max(0.0, min(1.0, 1.0 - completion_5s)), 6) if views > 0 else None
    bounce_2s = as_float(metrics.get("bounce_rate_2s")) if views > 0 else None
    return {
        "view_count": views,
        "cover_show": as_count(metrics.get("cover_show")),
        "bounce_rate_2s": bounce_2s,
        "bounce_rate_5s": bounce_5s,
        "completion_rate_5s": completion_5s if views > 0 else None,
        "completion_rate": as_float(metrics.get("completion_rate")) if views > 0 else None,
        "avg_view_second": as_float(metrics.get("avg_view_second"), 2) if views > 0 else 0.0,
        "avg_view_proportion": as_float(metrics.get("avg_view_proportion")) if views > 0 else None,
        "fan_view_proportion": as_float(metrics.get("fan_view_proportion")) if views > 0 else None,
        "like_count": as_count(metrics.get("like_count")),
        "like_rate": as_float(metrics.get("like_rate")) if views > 0 else 0.0,
        "comment_count": as_count(metrics.get("comment_count")),
        "comment_rate": as_float(metrics.get("comment_rate")) if views > 0 else 0.0,
        "favorite_count": as_count(metrics.get("favorite_count")),
        "favorite_rate": as_float(metrics.get("favorite_rate")) if views > 0 else 0.0,
        "share_count": as_count(metrics.get("share_count")),
        "share_rate": as_float(metrics.get("share_rate")) if views > 0 else 0.0,
        "subscribe_count": as_count(metrics.get("subscribe_count")),
        "subscribe_rate": as_float(metrics.get("subscribe_rate")) if views > 0 else 0.0,
        "homepage_visit_count": as_count(metrics.get("homepage_visit_count")),
        "dislike_count": as_count(metrics.get("dislike_count")),
        "dislike_rate": as_float(metrics.get("dislike_rate")) if views > 0 else 0.0,
    }


def summarize_creator_item(item):
    """把创作者中心 /web/api/creator/item/list 的作品压成结构化分析摘要。"""
    aweme_id = str(item.get("id") or item.get("aweme_id") or "")
    desc = str(item.get("description") or item.get("desc") or "").strip()
    first_line = desc.splitlines()[0].strip() if desc else ""
    video_info = item.get("video_info") or {}
    duration_ms = as_count(video_info.get("duration") or item.get("duration"))
    visibility = item.get("visibility")
    vis_type = visibility.get("type", 0) if isinstance(visibility, dict) else as_count(visibility)
    return {
        "aweme_id": aweme_id,
        "url": f"https://www.douyin.com/video/{aweme_id}" if aweme_id else "",
        "title_line": first_line[:60],
        "desc": desc,
        "create_time": as_count(item.get("create_time")),
        "duration_seconds": round(duration_ms / 1000, 1) if duration_ms else 0.0,
        "visibility_type": vis_type,
        "review_status": (item.get("review") or {}).get("status"),
        "metrics": normalize_creator_metrics(item.get("metrics")),
    }


def _avg(values, digits=6):
    valid = [v for v in values if v is not None]
    return round(sum(valid) / len(valid), digits) if valid else None


def summarize_creator_overview(works, min_views=20):
    """汇总近期作品的播放与留存均值，并给出可执行的黄金前 2s/5s 与完播/互动短板提示。"""
    with_views = [w for w in works if (w.get("metrics") or {}).get("view_count", 0) > 0]
    sample = [w for w in with_views if w["metrics"]["view_count"] >= int(min_views)] or with_views
    if not sample:
        return {
            "sample_count": 0,
            "min_views_threshold": int(min_views),
            "averages": {},
            "diagnostics": ["当前还没有已产生有效播放量的作品样本，发布后等待播放跑量再复盘。"],
        }

    ms = [w["metrics"] for w in sample]
    views_sorted = sorted(m["view_count"] for m in ms)
    mid = len(views_sorted) // 2
    median_views = (
        views_sorted[mid]
        if len(views_sorted) % 2 == 1
        else round((views_sorted[mid - 1] + views_sorted[mid]) / 2, 1)
    )
    averages = {
        "avg_views": round(sum(m["view_count"] for m in ms) / len(ms), 1),
        "median_views": median_views,
        "avg_bounce_rate_2s": _avg([m["bounce_rate_2s"] for m in ms]),
        "avg_bounce_rate_5s": _avg([m["bounce_rate_5s"] for m in ms]),
        "avg_completion_rate_5s": _avg([m["completion_rate_5s"] for m in ms]),
        "avg_completion_rate": _avg([m["completion_rate"] for m in ms]),
        "avg_view_second": _avg([m["avg_view_second"] for m in ms], 2),
        "avg_view_proportion": _avg([m["avg_view_proportion"] for m in ms]),
        "avg_like_rate": _avg([m["like_rate"] for m in ms]),
        "avg_comment_rate": _avg([m["comment_rate"] for m in ms]),
        "avg_favorite_rate": _avg([m["favorite_rate"] for m in ms]),
        "avg_share_rate": _avg([m["share_rate"] for m in ms]),
        "avg_subscribe_rate": _avg([m["subscribe_rate"] for m in ms]),
    }

    diagnostics = []
    b2 = averages["avg_bounce_rate_2s"]
    b5 = averages["avg_bounce_rate_5s"]
    vp = averages["avg_view_proportion"]
    cr = averages["avg_comment_rate"]
    fr = averages["avg_favorite_rate"]
    sr = averages["avg_subscribe_rate"]

    if b2 is not None and b2 >= 0.35:
        diagnostics.append(
            f"前 2 秒跳出率偏高（均值 {b2 * 100:.1f}%）：首帧画面冲击力或第一句台词悬念不足，建议开场 0 秒直接亮结果/反常识大字，删掉寒暄铺垫。"
        )
    if b5 is not None and b5 >= 0.62:
        diagnostics.append(
            f"前 5 秒跳出率偏高（均值 {b5 * 100:.1f}%，即 5 秒完播率仅 {(1 - b5) * 100:.1f}%）：黄金前 5 秒切入核心痛点偏慢，建议第 1-2 个分镜直接抛硬数字或利益承诺。"
        )
    if vp is not None and vp < 0.12:
        diagnostics.append(
            f"平均播放进度偏低（均值 {vp * 100:.1f}%）：中段信息密度稀释或单镜头停留过久，建议每 15-20 秒设置明确数字/对比锚点并加快分镜切换。"
        )
    if cr is not None and cr < 0.001:
        diagnostics.append(
            f"评论率偏低（均值 {cr * 100:.2f}%）：片尾或转折处缺少具体讨论抓手，建议埋设真实观点碰撞、实测悬念或观众有亲身经历的具体问题。"
        )
    if fr is not None and fr < 0.003:
        diagnostics.append(
            f"收藏率偏低（均值 {fr * 100:.2f}%）：可带走的工具感不足，建议增加可照抄的清单、速查对照卡或实操指令。"
        )
    if sr is not None and sr < 0.0008:
        diagnostics.append(
            f"吸粉率偏低（均值 {sr * 100:.2f}%）：建议强化固定栏目感与利他干货密度，让观众预期关注后持续获得同类硬核内容。"
        )
    if not diagnostics:
        diagnostics.append("近期作品前 2s/5s 留存与互动率整体稳健，可继续沿用表现最佳作品的开场钩子与节奏。")

    ranked_5s = [w for w in sample if w["metrics"]["bounce_rate_5s"] is not None]
    worst_5s = max(ranked_5s, key=lambda w: w["metrics"]["bounce_rate_5s"]) if ranked_5s else None
    best_5s = min(ranked_5s, key=lambda w: w["metrics"]["bounce_rate_5s"]) if ranked_5s else None

    result = {
        "sample_count": len(sample),
        "min_views_threshold": int(min_views),
        "averages": averages,
        "diagnostics": diagnostics,
    }
    if worst_5s:
        result["worst_5s_bounce_work"] = {
            "aweme_id": worst_5s["aweme_id"],
            "title_line": worst_5s["title_line"],
            "view_count": worst_5s["metrics"]["view_count"],
            "bounce_rate_5s": worst_5s["metrics"]["bounce_rate_5s"],
            "bounce_rate_2s": worst_5s["metrics"]["bounce_rate_2s"],
        }
    if best_5s:
        result["best_5s_retention_work"] = {
            "aweme_id": best_5s["aweme_id"],
            "title_line": best_5s["title_line"],
            "view_count": best_5s["metrics"]["view_count"],
            "bounce_rate_5s": best_5s["metrics"]["bounce_rate_5s"],
            "bounce_rate_2s": best_5s["metrics"]["bounce_rate_2s"],
        }
    return result


def _metric_status(name, self_val, compare_val):
    if self_val is None or compare_val is None:
        return "neutral"
    diff = self_val - compare_val
    if abs(diff) < 1e-6:
        return "neutral"
    if name in LOWER_IS_BETTER_METRICS:
        return "better" if diff < 0 else "worse"
    return "better" if diff > 0 else "worse"


def summarize_item_diagnosis(compare_resp, source_resp=None):
    """整理单条作品同级对比（diagnose/item_compare）与流量来源（item/play/source）。"""
    item_raw = (compare_resp or {}).get("item") or {}
    item_summary = summarize_creator_item(item_raw)

    benchmarks = []
    view_metric = (compare_resp or {}).get("view_count_metric")
    raw_metrics = ([view_metric] if isinstance(view_metric, dict) and view_metric.get("name") else []) + list(
        (compare_resp or {}).get("metrics") or []
    )

    for entry in raw_metrics:
        name = entry.get("name") or ""
        if not name:
            continue
        self_val = as_float(entry.get("self_value"))
        comp_val = as_float(entry.get("compare_value")) if entry.get("is_compare") else None
        ratio = as_float(entry.get("change_ratio"), 4) if entry.get("is_compare") else None
        benchmarks.append({
            "name": name,
            "label": entry.get("name_desc") or name,
            "self_value": self_val,
            "compare_value": comp_val,
            "change_ratio": ratio,
            "status": _metric_status(name, self_val, comp_val),
        })
        if name == "completion_rate_5s" and item_summary["metrics"]["view_count"] > 0:
            self_b5 = round(max(0.0, min(1.0, 1.0 - self_val)), 6)
            comp_b5 = round(max(0.0, min(1.0, 1.0 - comp_val)), 6) if comp_val is not None else None
            b5_ratio = (
                round((self_b5 - comp_b5) / comp_b5, 4)
                if comp_b5 not in (None, 0)
                else None
            )
            benchmarks.append({
                "name": "bounce_rate_5s",
                "label": "5秒跳出率",
                "self_value": self_b5,
                "compare_value": comp_b5,
                "change_ratio": b5_ratio,
                "status": _metric_status("bounce_rate_5s", self_b5, comp_b5),
            })

    weaknesses = [
        f"{b['label']}弱于历史同类基准（当前 {b['self_value']:.4f} vs 基准 {b['compare_value']:.4f}）"
        for b in benchmarks
        if b["status"] == "worse" and b["change_ratio"] is not None and abs(b["change_ratio"]) >= 0.15
    ]
    strengths = [
        f"{b['label']}优于历史同类基准（当前 {b['self_value']:.4f} vs 基准 {b['compare_value']:.4f}）"
        for b in benchmarks
        if b["status"] == "better" and b["change_ratio"] is not None and abs(b["change_ratio"]) >= 0.15
    ]

    sources = []
    for src in (source_resp or {}).get("play_source") or []:
        key = src.get("key") or "other"
        share = as_float(src.get("value"), 4)
        if share <= 0 and as_float(src.get("history_difference"), 4) == 0:
            continue
        sources.append({
            "key": key,
            "label": PLAY_SOURCE_LABELS.get(key, key),
            "share": share,
            "history_diff": as_float(src.get("history_difference"), 4),
        })
    sources.sort(key=lambda s: -s["share"])

    return {
        "item": item_summary,
        "compare_hour": (compare_resp or {}).get("compare_hour") or "",
        "benchmarks": benchmarks,
        "weaknesses": weaknesses,
        "strengths": strengths,
        "play_sources": sources,
    }
