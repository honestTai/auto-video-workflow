"""douyin-video-mcp 的命令行：每个子命令对应一个 MCP 工具，结果以 JSON 输出。

用法: python douyin_cli.py <子命令> [参数]
  account                                   查看账号与凭证状态
  set-account --name 名称 [--browser-type chrome|webbridge] [--cdp-url 地址] [--proxy-url 代理]
  refresh                                   从浏览器采集并保存登录凭证
  import-db <数据库路径> [--account 名称或id]   从另一个账号数据库只读导入账号与凭证
  search <关键词> [--limit 10] [--sort 0|1|2] [--publish-time 0|1|7|180] [--duration 0-1]
  info <链接或作品ID>
  download <链接或作品ID> [--output-dir 目录]
  publish --video 文件 --title 标题 [--desc 简介] [--tags AI,MCP] [--cover 图片]
          [--visibility 0|1|2] [--no-download] [--timing 时间戳] [--dry-run]
  publications [--limit 20]
  analytics [--limit 10] [--sort latest|play|like|comment] [--min-views 20]
  diagnose <作品ID或链接>
"""
import argparse
import json
import sys

from dotenv import load_dotenv

from .store import ROOT


def print_json(value, stream=None):
    print(json.dumps(value, ensure_ascii=False, indent=2), file=stream or sys.stdout)


def build_parser():
    parser = argparse.ArgumentParser(prog="douyin_cli.py", description="单账号抖音视频工具")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("account", aliases=["accounts"], help="查看账号与凭证状态")

    setter = commands.add_parser("set-account", help="绑定或修改账号")
    setter.add_argument("--name", required=True)
    setter.add_argument("--browser-type", default="chrome", choices=("chrome", "webbridge"))
    setter.add_argument("--cdp-url", default="")
    setter.add_argument("--proxy-url", default="")

    commands.add_parser("refresh", help="从浏览器采集并保存登录凭证")

    importer = commands.add_parser("import-db", help="从另一个账号数据库只读导入")
    importer.add_argument("source_db")
    importer.add_argument("--account", default="", help="账号名称或 id；不传则选凭证最新的账号")

    search = commands.add_parser("search", help="搜索视频")
    search.add_argument("keyword")
    search.add_argument("--limit", type=int, default=10)
    search.add_argument("--sort", default="0", choices=("0", "1", "2"))
    search.add_argument("--publish-time", default="0", choices=("0", "1", "7", "180"))
    search.add_argument("--duration", default="")

    info = commands.add_parser("info", help="作品详情")
    info.add_argument("url")

    download = commands.add_parser("download", help="下载无水印视频")
    download.add_argument("url")
    download.add_argument("--output-dir", default="")

    publish = commands.add_parser("publish", help="发布视频")
    publish.add_argument("--video", required=True)
    publish.add_argument("--title", required=True)
    publish.add_argument("--desc", default="")
    publish.add_argument("--tags", action="append", default=[], help="逗号分隔，可重复传")
    publish.add_argument("--cover", default="")
    publish.add_argument("--visibility", type=int, default=0, choices=(0, 1, 2))
    publish.add_argument("--no-download", action="store_true", help="不允许他人保存")
    publish.add_argument("--timing", type=int, default=None)
    publish.add_argument("--dry-run", action="store_true")

    history = commands.add_parser("publications", help="发布记录")
    history.add_argument("--limit", type=int, default=20)

    analytics = commands.add_parser("analytics", help="拉取账号近期作品播放/跳出/完播数据与短板诊断")
    analytics.add_argument("--limit", type=int, default=10)
    analytics.add_argument("--sort", default="latest", choices=("latest", "play", "like", "comment"))
    analytics.add_argument("--min-views", type=int, default=20)

    diagnose = commands.add_parser("diagnose", help="拉取单条作品同级对比与流量来源诊断")
    diagnose.add_argument("item_id", help="纯数字作品 ID 或作品链接")
    return parser


def run(args, service):
    command = args.command
    if command in ("account", "accounts"):
        return service.account_status()
    if command == "set-account":
        return service.set_account(args.name, args.browser_type, args.cdp_url, args.proxy_url)
    if command == "refresh":
        return service.refresh_runtime()
    if command == "import-db":
        return service.import_db(args.source_db, args.account)
    if command == "search":
        return service.search_videos(args.keyword, args.limit, args.sort, args.publish_time, args.duration)
    if command == "info":
        return service.get_video_info(args.url)
    if command == "download":
        return service.download_video(args.url, args.output_dir)
    if command == "publish":
        return service.publish_video(
            args.video, args.title, args.desc, args.tags, args.cover, args.visibility,
            not args.no_download, args.timing, args.dry_run,
        )
    if command == "publications":
        return service.list_publications(args.limit)
    if command == "analytics":
        return service.get_account_analytics(args.limit, args.sort, args.min_views)
    if command == "diagnose":
        return service.get_video_diagnosis(args.item_id)
    raise ValueError(f"未知子命令: {command}")


def main(argv=None, service=None):
    args = build_parser().parse_args(argv)
    try:
        if service is None:
            load_dotenv(ROOT / ".env")
            from .service import DouyinService
            service = DouyinService()
        result = run(args, service)
    except Exception as error:  # 命令行入口统一把错误转成 JSON
        print_json({"status": "error", "error": f"{type(error).__name__}: {error}"}, sys.stderr)
        return 1
    print_json(result)
    return 1 if isinstance(result, dict) and result.get("status") == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
