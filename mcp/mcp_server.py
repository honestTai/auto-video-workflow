"""douyin-video-mcp 的 stdio 启动入口。"""
from dy_mcp.server import mcp


if __name__ == "__main__":
    mcp.run(transport="stdio")
