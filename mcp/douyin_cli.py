"""douyin-video-mcp 的命令行入口（与 MCP 共用同一套 Service，输出 JSON）。"""
from dy_mcp.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
