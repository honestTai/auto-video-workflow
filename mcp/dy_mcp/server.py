"""douyin-video-mcp：单账号的抖音视频 MCP 服务（凭证、搜索、下载、发布）。"""
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from .store import ROOT

load_dotenv(ROOT / ".env")

from .service import DouyinService  # noqa: E402  需要先加载 .env


mcp = FastMCP(
    "douyin-video-mcp",
    instructions=(
        "单账号的抖音视频工具：从本机 Chrome 采集并保存登录凭证，拉取账号播放与留存诊断数据（2s/5s 跳出率、完播率、流量来源）、"
        "搜索视频、查看作品详情、下载无水印视频、发布视频到创作者中心。发布前可用 dry_run=true 只校验不上传。"
    ),
)
service = DouyinService()


@mcp.tool()
def account_status() -> dict:
    """查看当前绑定的抖音账号和登录凭证状态（saved / missing）；不返回任何凭证内容。"""
    return service.account_status()


@mcp.tool()
def set_account(name: str, browser_type: str = "chrome", cdp_url: str = "", proxy_url: str = "") -> dict:
    """绑定或修改抖音账号（只保存一个账号）。

    name: 账号备注名。
    browser_type: chrome（通过 Chrome 远程调试端口采集凭证）或 webbridge（通过本机浏览器扩展桥）。
    cdp_url: Chrome 远程调试地址，默认 http://127.0.0.1:9222；webbridge 不需要。
    proxy_url: 可选，该账号固定使用的出口代理。
    """
    return service.set_account(name, browser_type, cdp_url, proxy_url)


@mcp.tool()
def refresh_account_runtime() -> dict:
    """从已登录抖音的浏览器采集并保存登录凭证；凭证失效（搜索或发布报登录错误）时重新调用。"""
    return service.refresh_runtime()


@mcp.tool()
def search_videos(keyword: str, limit: int = 10, sort_type: str = "0",
                  publish_time: str = "0", filter_duration: str = "") -> dict:
    """按关键词搜索抖音视频，返回标题、话题标签、作者、点赞/评论/收藏/分享数和时长。

    sort_type: 0 综合排序、1 最多点赞、2 最新发布。
    publish_time: 0 不限、1 一天内、7 一周内、180 半年内。
    filter_duration: 空 不限、0-1 一分钟内、1-5 一到五分钟、5-10000 五分钟以上。
    limit: 返回条数，1-50。
    """
    return service.search_videos(keyword, limit, sort_type, publish_time, filter_duration)


@mcp.tool()
def get_video_info(url: str) -> dict:
    """查看一条作品的详情。url 可以是作品链接、纯数字作品 ID 或含 v.douyin.com 短链的分享文案。"""
    return service.get_video_info(url)


@mcp.tool()
def download_video(url: str, output_dir: str = "") -> dict:
    """下载一条作品的无水印视频，返回本地路径。output_dir 默认 mcp/.data/downloads。"""
    return service.download_video(url, output_dir)


@mcp.tool()
def publish_video(video: str, title: str, desc: str = "", tags: list[str] = [], cover: str = "",
                  visibility: int = 0, allow_download: bool = True,
                  timing: int | None = None, dry_run: bool = False) -> dict:
    """把本地视频发布到已绑定账号的抖音创作者中心。

    video: 本地视频文件路径。
    title: 标题。超过 20 个字符时，完整标题放进简介第一段，标题自动截到 20 字以内。
    desc: 简介正文。
    tags: 话题标签，如 ["AI", "MCP"]，自动整理成 #AI #MCP 追加到简介末尾并去重。
    cover: 可选，本地封面图路径；不传则由平台从视频里自动选帧。
    visibility: 0 公开、1 仅自己可见、2 好友可见。
    allow_download: 是否允许他人保存。
    timing: 可选，定时发布的秒级时间戳；不传则立即发布。
    dry_run: true 时只校验文件和发布凭证，不上传。
    """
    return service.publish_video(
        video, title, desc, tags, cover, visibility, allow_download, timing, dry_run,
    )


@mcp.tool()
def list_publications(limit: int = 20) -> dict:
    """查看最近的发布记录（含 dry_run 和失败记录）。"""
    return service.list_publications(limit)


@mcp.tool()
def get_account_analytics(limit: int = 10, sort_by: str = "latest", min_views: int = 20) -> dict:
    """拉取当前绑定账号在创作者中心的近期作品播放数据与留存短板诊断。

    返回每条作品的播放量、封面展现、2秒跳出率、5秒跳出率（bounce_rate_5s）、5秒完播率、整体完播率、
    平均播放时长、点赞/评论/收藏/分享/吸粉率，并自动汇总近期均值与可执行短板诊断。
    limit: 拉取条数，1-50，默认 10。
    sort_by: latest（最新发布）、play（最多播放）、like（最多点赞）、comment（最多评论）。
    min_views: 纳入均值基准线的最低播放量阈值（过滤刚发出尚未跑量的新作品），默认 20。
    """
    return service.get_account_analytics(limit=limit, sort_by=sort_by, min_views=min_views)


@mcp.tool()
def get_video_diagnosis(item_id: str) -> dict:
    """拉取当前账号某条已发布作品的深度诊断数据：与本号历史同类作品的指标对比（含 2秒跳出率、5秒跳出率、完播率、均播时长、互动与吸粉率）及流量来源占比（推荐页、搜索、个人主页等）。

    item_id: 纯数字作品 ID，或包含 /video/<id>、modal_id=<id> 的作品链接。
    """
    return service.get_video_diagnosis(item_id)


if __name__ == "__main__":
    mcp.run(transport="stdio")
